import { existsSync } from "node:fs";
import { totalmem } from "node:os";
import { basename } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { showOpenDialogOrStub } from "../e2e-dialog-stub";
import {
  builtinScriptModuleNameOrThrow,
  resolveBuiltinScriptsDirectory,
} from "./builtin-scripts";
import {
  createChunkedUserScriptRunSessionStore,
  type ChunkedUserScriptRunSessionStore,
  type ExecutableUserScriptRun,
} from "./chunked-user-script-run";
import { buildInterpreterResolutionEnvironment } from "./electron-interpreter-environment";
import { getConfiguredOwnInterpreterPath } from "./python-environment-controller";
import {
  resolvePythonInterpreterSelection,
  type PythonInterpreterSelection,
} from "./interpreter-resolver";
import {
  prepareImportedUserScriptFromFilePath,
  readSingleModuleUserScriptSource,
  type PreparedImportedScript,
} from "./script-import";
import {
  runUserScriptInPythonSubprocess,
  type PythonWorkerOutcome,
} from "./python-worker";
import type { JsonValue } from "./worker-protocol";
import { describeUserScriptRunMemoryRefusalOrNull } from "./user-script-run-memory";
import { wallClockTimeoutMsForUserScriptRun } from "./user-script-timeouts";
import {
  USER_SCRIPT_PICK_SCRIPT_CHANNEL,
  USER_SCRIPT_READ_SOURCE_CHANNEL,
  USER_SCRIPT_RUN_BEGIN_CHANNEL,
  USER_SCRIPT_RUN_CANCEL_CHANNEL,
  USER_SCRIPT_RUN_CUBE_CHUNK_CHANNEL,
  USER_SCRIPT_RUN_EXECUTE_CHANNEL,
  USER_SCRIPT_RUN_MAX_MASK_COUNT,
  USER_SCRIPT_RUN_PROGRESS_CHANNEL,
  USER_SCRIPT_RUN_RELEASE_CHANNEL,
  USER_SCRIPT_RUN_RESULT_CHUNK_CHANNEL,
  type UserScriptRunBeginRequest,
  type UserScriptRunBeginResult,
  type UserScriptRunCubeChunkRequest,
  type UserScriptRunExecuteRequest,
  type UserScriptRunExecuteResult,
  type UserScriptRunCancelRequest,
  type UserScriptRunReleaseRequest,
  type UserScriptRunResultChunkRequest,
  type UserScriptPickScriptResult,
  type UserScriptReadSourceResult,
  type UserScriptRunResultKind,
  type UserScriptRunSource,
} from "../../shared/chunked-user-script-run-protocol";

// CT-209/CT-210: the renderer's band-ops popups run a user formula or imported
// tool against the current stack. The interpreter selection, sandbox decision,
// import dialog, subprocess run, and temp cleanup all live here so the renderer
// only sends the cube and gets weights/bands back. Bundled mode is sandboxed;
// own-environment mode (CT-208e) runs trusted. CT-216: a resultKind of 'cube'
// (the Custom transform) returns the transformed whole cube and runs under the
// longer 120 s wall clock.
// CT-219g: the cube crosses IPC through the CHUNKED run protocol
// (src/shared/chunked-user-script-run-protocol.ts) instead of one whole-cube
// invoke, which wedged the renderer at reference scale. Session bookkeeping is
// the electron-free chunked-user-script-run.ts; this module wires the channels
// and owns everything that needs electron.

const IMPORTED_SCRIPT_FILE_FILTER: Electron.FileFilter = {
  name: "Python tool",
  extensions: ["py", "zip"],
};

interface PreparedUserScriptRun {
  prepared: PreparedImportedScript;
  sourceName: string | null;
}

export function registerRunUserScriptIpcHandler(): void {
  const sessions = createChunkedUserScriptRunSessionStore();
  ipcMain.handle(USER_SCRIPT_PICK_SCRIPT_CHANNEL, (event) =>
    handlePickUserScriptFile(findWindowForIpcEvent(event)),
  );
  ipcMain.handle(USER_SCRIPT_READ_SOURCE_CHANNEL, (_event, filePath: string) =>
    handleReadUserScriptSource(filePath),
  );
  ipcMain.handle(USER_SCRIPT_RUN_BEGIN_CHANNEL, (event, request: UserScriptRunBeginRequest) =>
    handleBeginUserScriptRun(sessions, event, request),
  );
  ipcMain.handle(USER_SCRIPT_RUN_CUBE_CHUNK_CHANNEL, (_event, request: UserScriptRunCubeChunkRequest) =>
    sessions.appendCubeChunk(request.token, request.bytes),
  );
  ipcMain.handle(USER_SCRIPT_RUN_EXECUTE_CHANNEL, (event, request: UserScriptRunExecuteRequest) =>
    handleExecuteUserScriptRun(sessions, event, request),
  );
  ipcMain.handle(USER_SCRIPT_RUN_RESULT_CHUNK_CHANNEL, (_event, request: UserScriptRunResultChunkRequest) =>
    sessions.readNextResultChunk(request.token),
  );
  ipcMain.handle(USER_SCRIPT_RUN_RELEASE_CHANNEL, (_event, request: UserScriptRunReleaseRequest) =>
    sessions.release(request.token),
  );
  ipcMain.handle(USER_SCRIPT_RUN_CANCEL_CHANNEL, (_event, request: UserScriptRunCancelRequest) =>
    sessions.cancelExecutingRun(request.token),
  );
}

async function handleBeginUserScriptRun(
  sessions: ChunkedUserScriptRunSessionStore,
  event: Electron.IpcMainInvokeEvent,
  request: UserScriptRunBeginRequest,
): Promise<UserScriptRunBeginResult> {
  // CT-241: refuse a run whose worker memory cannot fit the machine BEFORE the
  // import dialog shows or any cube bytes spool (no session, no temp file).
  const memoryRefusal = describeUserScriptRunMemoryRefusalOrNull(
    request.cube,
    request.resultKind,
    totalmem(),
  );
  if (memoryRefusal !== null) return { status: "failed", message: memoryRefusal };
  try {
    validateMasksDescriptor(request);
    const selection = resolveInterpreterSelectionOrThrow();
    const run = await prepareUserScriptInputOrCancel(findWindowForIpcEvent(event), request.source);
    if (run === null) return { status: "canceled" };
    return await beginSessionForPreparedRun(sessions, request, selection, run);
  } catch (error) {
    return { status: "failed", message: describeUserScriptFailure(error) };
  }
}

// CT-307: the product caps mask categories at 5; a larger (or non-integer)
// count in a begin request is a harness bug surfaced as a plain failure.
function validateMasksDescriptor(request: UserScriptRunBeginRequest): void {
  const count = request.masks?.count ?? 0;
  if (!Number.isInteger(count) || count < 0 || count > USER_SCRIPT_RUN_MAX_MASK_COUNT) {
    throw new Error("The script run described an invalid mask set.");
  }
}

async function beginSessionForPreparedRun(
  sessions: ChunkedUserScriptRunSessionStore,
  request: UserScriptRunBeginRequest,
  selection: PythonInterpreterSelection,
  run: PreparedUserScriptRun,
): Promise<UserScriptRunBeginResult> {
  try {
    const token = await sessions.begin({
      cube: request.cube,
      maskCount: request.masks?.count ?? 0,
      resultKind: request.resultKind,
      input: run.prepared.input,
      releaseInputResources: run.prepared.releaseResources,
      sourceName: run.sourceName,
      interpreterPath: selection.interpreterPath,
      sandbox: !selection.isOwnEnvironmentMode,
      residentWorker: request.residentWorker === true,
    });
    return { status: "ready", token, sourceName: run.sourceName };
  } catch (error) {
    await run.prepared.releaseResources().catch(() => undefined);
    throw error;
  }
}

function resolveInterpreterSelectionOrThrow(): PythonInterpreterSelection {
  return resolvePythonInterpreterSelection(
    buildInterpreterResolutionEnvironment(getConfiguredOwnInterpreterPath()),
  );
}

async function prepareUserScriptInputOrCancel(
  window: BrowserWindow | null,
  source: UserScriptRunSource,
): Promise<PreparedUserScriptRun | null> {
  if (source.mode === "formula") {
    return {
      prepared: { input: { kind: "formula", expression: source.expression }, releaseResources: releaseNothing },
      sourceName: null,
    };
  }
  if (source.mode === "builtin") return prepareBuiltinScriptRun(source.scriptName);
  if (source.scriptPath !== undefined) return prepareImportedUserScriptFromKnownPath(source.scriptPath);
  return prepareImportedUserScriptFromDialog(window);
}

// CT-307: a builtin run names a packaged Stage 6 algorithm script; main
// resolves the directory itself (dev repo vs. process.resourcesPath) and no
// dialog is shown.
function prepareBuiltinScriptRun(scriptName: string): PreparedUserScriptRun {
  const moduleName = builtinScriptModuleNameOrThrow(scriptName);
  const directory = resolveBuiltinScriptsDirectory({
    isPackagedApp: app.isPackaged,
    packagedResourcesPath: process.resourcesPath,
    developmentRepoRootPath: app.getAppPath(),
    fileExists: existsSync,
  });
  return {
    prepared: { input: { kind: "builtin", directory, moduleName }, releaseResources: releaseNothing },
    sourceName: moduleName,
  };
}

// The Custom transform picks its script file up front (the pick-script channel)
// and runs at Apply time, so its begin carries the path and shows no dialog.
async function prepareImportedUserScriptFromKnownPath(
  scriptPath: string,
): Promise<PreparedUserScriptRun> {
  return {
    prepared: await prepareImportedUserScriptFromFilePath(scriptPath),
    sourceName: basename(scriptPath),
  };
}

// CT-310: the renderer reads a picked objective script's source so it can ride
// a built-in run's params; a read failure is a plain message, never a throw
// across the bridge.
async function handleReadUserScriptSource(filePath: string): Promise<UserScriptReadSourceResult> {
  try {
    return { status: "read", source: await readSingleModuleUserScriptSource(filePath) };
  } catch (error) {
    return { status: "failed", message: describeUserScriptFailure(error) };
  }
}

async function handlePickUserScriptFile(
  window: BrowserWindow | null,
): Promise<UserScriptPickScriptResult> {
  const filePath = await chooseImportedScriptFilePathOrNull(window);
  if (filePath === null) return { canceled: true };
  return { canceled: false, filePath, fileName: basename(filePath) };
}

async function prepareImportedUserScriptFromDialog(
  window: BrowserWindow | null,
): Promise<PreparedUserScriptRun | null> {
  const filePath = await chooseImportedScriptFilePathOrNull(window);
  if (filePath === null) return null;
  return { prepared: await prepareImportedUserScriptFromFilePath(filePath), sourceName: basename(filePath) };
}

async function chooseImportedScriptFilePathOrNull(
  window: BrowserWindow | null,
): Promise<string | null> {
  if (!window) return null;
  const result = await showOpenDialogOrStub(window, {
    title: "Import Script",
    properties: ["openFile"],
    filters: [IMPORTED_SCRIPT_FILE_FILTER],
  });
  const [firstPath] = result.filePaths;
  return result.canceled || firstPath === undefined ? null : firstPath;
}

// CT-307: input resources and the spooled cube are NOT released here - the
// session retains them so ROP can re-execute without re-uploading; release()
// cleans everything up.
async function handleExecuteUserScriptRun(
  sessions: ChunkedUserScriptRunSessionStore,
  event: Electron.IpcMainInvokeEvent,
  request: UserScriptRunExecuteRequest,
): Promise<UserScriptRunExecuteResult> {
  const token = request.token;
  try {
    const run = sessions.takeExecutableRun(token);
    const outcome = await runExecutableUserScript(sessions, event, request, run);
    return mapWorkerOutcomeToExecuteResult(sessions, token, run.resultKind, outcome);
  } catch (error) {
    return { status: "failed", message: describeUserScriptFailure(error) };
  } finally {
    sessions.clearExecutingWorkerKill(token);
    sessions.markExecutionSettled(token);
  }
}

// CT-335: a resident-worker session (only the ROP aside opens one) executes on
// the retained interpreter; every other run keeps spawning a subprocess per
// execute. The builtin guard is defensive - only builtin sources open resident
// sessions today, and an execute frame can only name a builtin module.
function runExecutableUserScript(
  sessions: ChunkedUserScriptRunSessionStore,
  event: Electron.IpcMainInvokeEvent,
  request: UserScriptRunExecuteRequest,
  run: ExecutableUserScriptRun,
): Promise<PythonWorkerOutcome> {
  if (run.usesResidentWorker && run.input.kind === "builtin") {
    return executeOnSessionResidentWorker(sessions, event, request, run, run.input);
  }
  return runExecutableUserScriptInSubprocess(sessions, event, request, run);
}

// The store respawns a dead resident worker from the retained spool, and Stop
// registers the worker's kill exactly like a one-shot run, so the cancel
// channel works unchanged; the next press then respawns instead of wedging.
function executeOnSessionResidentWorker(
  sessions: ChunkedUserScriptRunSessionStore,
  event: Electron.IpcMainInvokeEvent,
  request: UserScriptRunExecuteRequest,
  run: ExecutableUserScriptRun,
  builtin: { directory: string; moduleName: string },
): Promise<PythonWorkerOutcome> {
  const timeoutMs = wallClockTimeoutMsForUserScriptRun(run.resultKind, run.cube.totalByteLength);
  const worker = sessions.acquireResidentWorkerForExecute(request.token, timeoutMs);
  sessions.registerExecutingWorkerKill(request.token, () => worker.kill());
  return worker.execute(
    sanitizeExecuteParamsOrNull(request.params),
    { directory: builtin.directory, moduleName: builtin.moduleName },
    run.resultKind === "cube" ? run.cubeResultSpoolPath : null,
    { onProgress: (fraction) => sendRunProgressToRenderer(event.sender, request.token, fraction) },
  );
}

// CT-268: the worker registers its cancel trigger with the session store while
// it runs, so the cancel channel can SIGKILL the subprocess mid-run.
// CT-307: per-execute params ride the execute request, and in-script progress
// frames are pushed to the requesting renderer keyed by the run token.
function runExecutableUserScriptInSubprocess(
  sessions: ChunkedUserScriptRunSessionStore,
  event: Electron.IpcMainInvokeEvent,
  request: UserScriptRunExecuteRequest,
  run: ExecutableUserScriptRun,
): Promise<PythonWorkerOutcome> {
  return runUserScriptInPythonSubprocess({
    interpreterPath: run.interpreterPath,
    input: run.input,
    cube: run.cube,
    masks: run.masks,
    params: sanitizeExecuteParamsOrNull(request.params),
    resultKind: run.resultKind,
    cubeResultSpoolPath: run.cubeResultSpoolPath,
    sandbox: run.sandbox,
    timeoutMs: wallClockTimeoutMsForUserScriptRun(run.resultKind, run.cube.totalByteLength),
    registerCancel: (cancelRun) => sessions.registerExecutingWorkerKill(request.token, cancelRun),
    onProgress: (fraction) => sendRunProgressToRenderer(event.sender, request.token, fraction),
  });
}

// Params crossed one IPC invoke, so they are structured-clone data; anything
// that is not a plain object is dropped rather than sent to the worker.
function sanitizeExecuteParamsOrNull(params: unknown): JsonValue | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return params as JsonValue;
}

function sendRunProgressToRenderer(
  sender: Electron.WebContents,
  token: string,
  fraction: number,
): void {
  if (sender.isDestroyed()) return;
  sender.send(USER_SCRIPT_RUN_PROGRESS_CHANNEL, { token, fraction });
}

function mapWorkerOutcomeToExecuteResult(
  sessions: ChunkedUserScriptRunSessionStore,
  token: string,
  resultKind: UserScriptRunResultKind,
  outcome: PythonWorkerOutcome,
): UserScriptRunExecuteResult {
  if (outcome.kind === "failed") return { status: "failed", message: outcome.userFacingMessage };
  if (outcome.kind === "completed-cube") {
    return mapCubeOutcomeToExecuteResult(sessions, token, resultKind, outcome);
  }
  return mapValueOutcomeToExecuteResult(resultKind, outcome);
}

// The worker's outcome kind is dictated by the requested resultKind, so a
// mismatch here is a harness bug surfaced as a plain failure.
function mapCubeOutcomeToExecuteResult(
  sessions: ChunkedUserScriptRunSessionStore,
  token: string,
  resultKind: UserScriptRunResultKind,
  outcome: Extract<PythonWorkerOutcome, { kind: "completed-cube" }>,
): UserScriptRunExecuteResult {
  if (resultKind !== "cube") {
    return { status: "failed", message: "The script returned an unexpected cube result." };
  }
  const stored = sessions.storeCubeResultForPull(token, outcome.shape, outcome.totalBytes);
  return { status: "completed-cube", shape: outcome.shape, totalBytes: stored.totalBytes };
}

function mapValueOutcomeToExecuteResult(
  resultKind: UserScriptRunResultKind,
  outcome: Extract<PythonWorkerOutcome, { kind: "completed" }>,
): UserScriptRunExecuteResult {
  if (resultKind !== "value") {
    return { status: "failed", message: "The script returned an unexpected non-cube result." };
  }
  return { status: "completed", value: outcome.value };
}

function describeUserScriptFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findWindowForIpcEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function releaseNothing(): Promise<void> {
  return Promise.resolve();
}
