import { USER_SCRIPT_RUN_CHUNK_BYTES } from "@shared/chunked-user-script-run-protocol";

import { isOperationStoppedError, throwIfOperationStopped } from "@/lib/image/operation-stop";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import { createCubeResultChunkAssembler } from "./cube-result-chunk-assembler";

// CT-219g: drives the chunked user-script run protocol from the renderer. The
// old single window.toolboxApi.runUserScript invoke carried the whole cube
// (~3 GB at reference scale) and V8's ValueSerializer killed the renderer
// process outright once the wire buffer doubled past Chromium's 2 GiB
// single-allocation cap (measured cliff between 1.0 and 1.5 GB aggregate).
// This orchestrator streams the cube up band by band in small chunks, executes
// the run, and pulls a cube result back down the same way, so no context-bridge
// crossing or invoke ever approaches the danger zone and every await between
// chunks keeps the renderer interactive. The api is injected so the sequencing
// is unit-testable without the bridge.

export interface UserScriptRunCubeInput {
  readonly bandCount: number;
  readonly height: number;
  readonly width: number;
  readonly wavelengths: number[] | null;
  // Bands are pulled one at a time so integer sources convert to float32
  // lazily, band by band, instead of holding a whole second copy of the stack.
  readonly getBandAsFloat32: (bandIndex: number) => Float32Array;
}

export interface UserScriptRunChunkedApi {
  beginUserScriptRun(request: ToolboxUserScriptRunBeginRequest): Promise<ToolboxUserScriptRunBeginResult>;
  sendUserScriptRunCubeChunk(request: ToolboxUserScriptRunCubeChunkRequest): Promise<void>;
  executeUserScriptRun(request: ToolboxUserScriptRunExecuteRequest): Promise<ToolboxUserScriptRunExecuteResult>;
  readUserScriptRunResultChunk(
    request: ToolboxUserScriptRunResultChunkRequest,
  ): Promise<ToolboxUserScriptRunResultChunkResult>;
  releaseUserScriptRun(request: ToolboxUserScriptRunReleaseRequest): Promise<void>;
  cancelUserScriptRun(request: ToolboxUserScriptRunCancelRequest): Promise<void>;
  // CT-307: in-script progress pushed from main while a run executes; optional
  // so fake apis in tests (and older callers) need not provide it.
  onUserScriptRunProgress?(listener: (event: ToolboxUserScriptRunProgressEvent) => void): () => void;
}

// CT-307: per-run extras for the Stage 6 built-in algorithms - category masks
// (uint8 bytes appended after the cube on the chunk channel) and the plain
// params dict for run()'s third positional argument.
export interface UserScriptRunExtras {
  readonly masks?: ReadonlyArray<Uint8Array>;
  readonly params?: Record<string, unknown>;
}

export interface ChunkedUserScriptRunCallbacks {
  // Fired after the run is prepared (the import dialog, when any, is resolved)
  // and the cube transfer is about to start; register busy feedback here.
  readonly onRunReady?: () => void;
  // Upload fraction 0..1 while the cube streams up, then null (indeterminate)
  // while the worker runs and any cube result pulls back down.
  readonly onUploadProgress?: (fraction: number | null) => void;
  // CT-268: the apply flow's stop token. Checked between upload chunks; an
  // abort during the worker run kills the Python subprocess via the cancel
  // channel. A stopped run THROWS OperationStoppedError (never a failed
  // result), so the apply flow shows "Operation stopped" instead of an error.
  readonly abortSignal?: AbortSignal;
  // CT-307: in-script determinate progress (fraction 0..1) while the worker
  // runs; only fires when the script reports through its progress callback.
  readonly onWorkerProgress?: (fraction: number) => void;
}

export async function runUserScriptOverCubeInChunks(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  source: ToolboxRunUserScriptSource,
  resultKind: ToolboxRunUserScriptResultKind,
  callbacks: ChunkedUserScriptRunCallbacks = {},
  chunkBytes: number = USER_SCRIPT_RUN_CHUNK_BYTES,
  extras: UserScriptRunExtras = {},
): Promise<ToolboxRunUserScriptResult> {
  const opened = await openSessionMappingTransferFailure(api, cube, source, resultKind, callbacks, chunkBytes, extras);
  if (opened.status !== "open") return opened;
  try {
    return await executeSessionMappingTransferFailure(opened.session, extras.params, callbacks);
  } finally {
    await opened.session.release();
  }
}

// CT-309: a retained run session. The cube (and any masks) upload ONCE at open;
// each execute reuses the retained spool in main, so repeated runs (the ROP
// panel's presses) never re-upload the source stack. release() drops the spool.
export interface UserScriptRunSession {
  execute(
    params: Record<string, unknown> | undefined,
    callbacks?: ChunkedUserScriptRunCallbacks,
  ): Promise<ToolboxRunUserScriptResult>;
  release(): Promise<void>;
}

export type UserScriptRunSessionOpenResult =
  | { readonly status: "open"; readonly session: UserScriptRunSession }
  | { readonly status: "canceled" }
  | { readonly status: "failed"; readonly message: string };

// Throws OperationStoppedError on an aborted upload and rethrows transport
// errors (releasing the begun run first); callers map those like the one-shot
// wrappers below do. CT-335: a session exists to execute MANY times, so its
// begin asks main for a resident worker (one interpreter loads the cube once
// and answers every execute); the one-shot wrapper keeps spawning per run.
export async function openUserScriptRunSessionOverCube(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  source: ToolboxRunUserScriptSource,
  resultKind: ToolboxRunUserScriptResultKind,
  callbacks: ChunkedUserScriptRunCallbacks = {},
  chunkBytes: number = USER_SCRIPT_RUN_CHUNK_BYTES,
  extras: UserScriptRunExtras = {},
): Promise<UserScriptRunSessionOpenResult> {
  return openRunSessionOverCube(api, cube, source, resultKind, callbacks, chunkBytes, extras, true);
}

async function openRunSessionOverCube(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  source: ToolboxRunUserScriptSource,
  resultKind: ToolboxRunUserScriptResultKind,
  callbacks: ChunkedUserScriptRunCallbacks,
  chunkBytes: number,
  extras: UserScriptRunExtras,
  withResidentWorker: boolean,
): Promise<UserScriptRunSessionOpenResult> {
  const begun = await api.beginUserScriptRun(
    buildBeginRequest(cube, source, resultKind, extras, withResidentWorker),
  );
  if (begun.status !== "ready") return begun;
  callbacks.onRunReady?.();
  await uploadCubeAndMasksReleasingRunOnFailure(api, cube, begun.token, callbacks, chunkBytes, extras);
  return { status: "open", session: buildOpenUserScriptRunSession(api, begun.token, begun.sourceName) };
}

async function uploadCubeAndMasksReleasingRunOnFailure(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  token: string,
  callbacks: ChunkedUserScriptRunCallbacks,
  chunkBytes: number,
  extras: UserScriptRunExtras,
): Promise<void> {
  try {
    await uploadCubeBandsInChunks(api, cube, token, chunkBytes, callbacks.onUploadProgress, callbacks.abortSignal);
    await uploadMaskCategoryBytes(api, cube, token, extras.masks, callbacks.abortSignal);
    callbacks.onUploadProgress?.(null);
  } catch (error) {
    await api.releaseUserScriptRun({ token }).catch(() => undefined);
    throw error;
  }
}

function buildOpenUserScriptRunSession(
  api: UserScriptRunChunkedApi,
  token: string,
  sourceName: string | null,
): UserScriptRunSession {
  return {
    execute: async (params, callbacks = {}) => {
      const executed = await executeRunKillingWorkerOnAbort(api, token, callbacks, params);
      throwIfOperationStopped(callbacks.abortSignal);
      return assembleExecutedRunResult(api, token, executed, sourceName);
    },
    release: () => api.releaseUserScriptRun({ token }).catch(() => undefined),
  };
}

async function openSessionMappingTransferFailure(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  source: ToolboxRunUserScriptSource,
  resultKind: ToolboxRunUserScriptResultKind,
  callbacks: ChunkedUserScriptRunCallbacks,
  chunkBytes: number,
  extras: UserScriptRunExtras,
): Promise<UserScriptRunSessionOpenResult> {
  try {
    return await openRunSessionOverCube(api, cube, source, resultKind, callbacks, chunkBytes, extras, false);
  } catch (error) {
    if (isOperationStoppedError(error)) throw error;
    return { status: "failed", message: describeUserScriptRunTransferFailure(error) };
  }
}

async function executeSessionMappingTransferFailure(
  session: UserScriptRunSession,
  params: Record<string, unknown> | undefined,
  callbacks: ChunkedUserScriptRunCallbacks,
): Promise<ToolboxRunUserScriptResult> {
  try {
    return await session.execute(params, callbacks);
  } catch (error) {
    if (isOperationStoppedError(error)) throw error;
    return { status: "failed", message: describeUserScriptRunTransferFailure(error) };
  }
}

// The residentWorker flag rides only session begins, so a one-shot begin
// request stays byte-identical to what it was before CT-335.
function buildBeginRequest(
  cube: UserScriptRunCubeInput,
  source: ToolboxRunUserScriptSource,
  resultKind: ToolboxRunUserScriptResultKind,
  extras: UserScriptRunExtras,
  withResidentWorker: boolean,
): ToolboxUserScriptRunBeginRequest {
  const maskCount = extras.masks?.length ?? 0;
  return {
    source,
    resultKind,
    cube: describeCube(cube),
    ...(maskCount > 0 ? { masks: { count: maskCount } } : {}),
    ...(withResidentWorker ? { residentWorker: true } : {}),
  };
}

function describeCube(cube: UserScriptRunCubeInput): ToolboxUserScriptRunCubeDescriptor {
  return {
    bandCount: cube.bandCount,
    height: cube.height,
    width: cube.width,
    wavelengths: cube.wavelengths,
  };
}

// CT-307: category mask bytes follow the cube bytes on the same chunk channel;
// each mask is height * width uint8 samples. Masks are tiny next to the cube
// (one byte per pixel per category), so they ride single chunks and take no
// share of the upload progress fraction.
async function uploadMaskCategoryBytes(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  token: string,
  masks: ReadonlyArray<Uint8Array> | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<void> {
  if (masks === undefined || masks.length === 0) return;
  for (const mask of masks) {
    if (mask.byteLength !== cube.height * cube.width) {
      throw new Error("A mask did not match the described stack shape.");
    }
    throwIfOperationStopped(abortSignal);
    await api.sendUserScriptRunCubeChunk({ token, bytes: mask.slice() });
  }
}

// CT-268: while the worker executes, an abort invokes the cancel channel, which
// SIGKILLs the Python subprocess; the pending execute invoke then settles and
// the post-execute stop check converts the run into OperationStoppedError.
// CT-307: in-script progress frames for this token feed onWorkerProgress.
async function executeRunKillingWorkerOnAbort(
  api: UserScriptRunChunkedApi,
  token: string,
  callbacks: ChunkedUserScriptRunCallbacks,
  params: Record<string, unknown> | undefined,
): Promise<ToolboxUserScriptRunExecuteResult> {
  const abortSignal = callbacks.abortSignal;
  const killWorkerBecauseStopped = (): void => {
    void api.cancelUserScriptRun({ token }).catch(() => undefined);
  };
  throwIfOperationStopped(abortSignal);
  abortSignal?.addEventListener("abort", killWorkerBecauseStopped, { once: true });
  const unsubscribeProgress = subscribeToWorkerProgressForToken(api, token, callbacks.onWorkerProgress);
  try {
    return await api.executeUserScriptRun({ token, ...(params !== undefined ? { params } : {}) });
  } finally {
    unsubscribeProgress();
    abortSignal?.removeEventListener("abort", killWorkerBecauseStopped);
  }
}

function subscribeToWorkerProgressForToken(
  api: UserScriptRunChunkedApi,
  token: string,
  onWorkerProgress: ((fraction: number) => void) | undefined,
): () => void {
  if (onWorkerProgress === undefined || api.onUserScriptRunProgress === undefined) {
    return () => undefined;
  }
  return api.onUserScriptRunProgress((event) => {
    if (event.token === token) onWorkerProgress(event.fraction);
  });
}

async function uploadCubeBandsInChunks(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  token: string,
  chunkBytes: number,
  onProgress: ((fraction: number | null) => void) | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<void> {
  const totalBytes = cube.bandCount * cube.height * cube.width * Float32Array.BYTES_PER_ELEMENT;
  onProgress?.(0);
  let sentBytes = 0;
  for (let bandIndex = 0; bandIndex < cube.bandCount; bandIndex += 1) {
    const band = takeBandMatchingCubeShape(cube, bandIndex);
    sentBytes = await uploadOneBandInChunks(api, token, band, chunkBytes, sentBytes, totalBytes, onProgress, abortSignal);
  }
}

function takeBandMatchingCubeShape(cube: UserScriptRunCubeInput, bandIndex: number): Float32Array {
  const band = cube.getBandAsFloat32(bandIndex);
  if (band.length !== cube.height * cube.width) {
    throw new Error("A stack band did not match the described stack shape.");
  }
  return band;
}

async function uploadOneBandInChunks(
  api: UserScriptRunChunkedApi,
  token: string,
  band: Float32Array,
  chunkBytes: number,
  sentBytes: number,
  totalBytes: number,
  onProgress: ((fraction: number | null) => void) | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<number> {
  const bandBytes = new Uint8Array(band.buffer, band.byteOffset, band.byteLength);
  let sent = sentBytes;
  for (let offset = 0; offset < bandBytes.byteLength; offset += chunkBytes) {
    throwIfOperationStopped(abortSignal);
    // slice copies, so the IPC layer never serializes a view over the whole band.
    const chunk = bandBytes.slice(offset, Math.min(offset + chunkBytes, bandBytes.byteLength));
    await api.sendUserScriptRunCubeChunk({ token, bytes: chunk });
    sent += chunk.byteLength;
    onProgress?.(sent / totalBytes);
  }
  return sent;
}

async function assembleExecutedRunResult(
  api: UserScriptRunChunkedApi,
  token: string,
  executed: ToolboxUserScriptRunExecuteResult,
  sourceName: string | null,
): Promise<ToolboxRunUserScriptResult> {
  if (executed.status === "failed") return executed;
  if (executed.status === "completed") {
    return attachSourceName({ status: "completed", value: executed.value }, sourceName);
  }
  const bands = await pullResultCubeBands(api, token, executed.shape, executed.totalBytes);
  return attachSourceName({ status: "completed-cube", shape: executed.shape, bands }, sourceName);
}

async function pullResultCubeBands(
  api: UserScriptRunChunkedApi,
  token: string,
  shape: [number, number, number],
  totalBytes: number,
): Promise<Float32Array[]> {
  const assembler = createCubeResultChunkAssembler(shape, totalBytes);
  let done = false;
  while (!done) {
    const chunk = await api.readUserScriptRunResultChunk({ token });
    assembler.append(chunk.bytes);
    done = chunk.done;
  }
  return assembler.finish();
}

function attachSourceName(
  result: Extract<ToolboxRunUserScriptResult, { status: "completed" | "completed-cube" }>,
  sourceName: string | null,
): ToolboxRunUserScriptResult {
  if (sourceName === null) return result;
  return { ...result, sourceName };
}

export function describeUserScriptRunTransferFailure(error: unknown): string {
  return describeElectronInvokeFailure(error);
}
