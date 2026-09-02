// Chunked user-script run protocol (CT-219g), shared between the main process
// handlers (src/main/python/chunked-user-script-run*.ts), the preload bridge,
// and the renderer orchestrator (src/renderer/src/lib/python/run-user-script-chunked.ts).
//
// WHY CHUNKS: the old user-script:run channel carried the WHOLE cube (16
// Float32Array bands, ~3 GB at reference scale) in ONE ipcRenderer.invoke.
// Serializing a multi-gigabyte structured-clone payload wedges the renderer
// main thread indefinitely (the CT-219g audit finding; see
// chunked-opened-image-read-protocol.ts for the sibling CT-219b failure where
// the same shape killed the main process outright). Streaming the cube up in
// small sequential chunks, and pulling a cube result back down the same way,
// keeps every IPC message and every context-bridge crossing far below the
// danger zone at any stack size, and the awaits between chunks keep the
// renderer interactive.
//
// FLOW: begin (resolves the script input, showing the import dialog when
// needed, BEFORE any cube bytes move) -> N cube-chunk uploads (band-major
// float32 bytes) -> execute (spawns the Python worker under the wall-clock
// limit) -> for cube results, N result-chunk pulls -> release.

export const USER_SCRIPT_PICK_SCRIPT_CHANNEL = "user-script:pick-script";
// CT-310: reads a PICKED single-module script's source so the renderer can
// hand it to a built-in algorithm as a parameter (the ROP search evaluates a
// custom objective per candidate inside its own run). Reading stays in TS.
export const USER_SCRIPT_READ_SOURCE_CHANNEL = "user-script:read-source";
export const USER_SCRIPT_RUN_BEGIN_CHANNEL = "user-script:run-begin";
export const USER_SCRIPT_RUN_CUBE_CHUNK_CHANNEL = "user-script:run-cube-chunk";
export const USER_SCRIPT_RUN_EXECUTE_CHANNEL = "user-script:run-execute";
export const USER_SCRIPT_RUN_RESULT_CHUNK_CHANNEL = "user-script:run-result-chunk";
export const USER_SCRIPT_RUN_RELEASE_CHANNEL = "user-script:run-release";
// CT-268: cancels an EXECUTING run by killing its Python worker subprocess; the
// pending execute invoke then settles with a failed result. A token with no
// executing worker (not begun, already settled) cancels nothing.
export const USER_SCRIPT_RUN_CANCEL_CHANNEL = "user-script:run-cancel";

// CT-307: while a run session executes, in-script progress frames from the
// Python worker are pushed to the renderer over this channel (main -> renderer,
// webContents.send), keyed by the run token so overlapping sessions stay apart.
export const USER_SCRIPT_RUN_PROGRESS_CHANNEL = "user-script:run-progress";

export const USER_SCRIPT_RUN_CHUNK_BYTES = 64 * 1024 * 1024;

// CT-307: the packaged algorithm scripts shipped under resources/builtin-python.
// A begin request may only name one of these; the main process resolves the
// name to the built-in script directory (never a renderer-supplied path).
export const BUILTIN_SCRIPT_NAMES = [
  "npc",
  "rop",
  "rop_search",
  "local_pca",
  "local_mnf",
  "l2_minimization",
] as const;

export type BuiltinScriptName = (typeof BUILTIN_SCRIPT_NAMES)[number];

export function isBuiltinScriptName(candidate: string): candidate is BuiltinScriptName {
  return (BUILTIN_SCRIPT_NAMES as ReadonlyArray<string>).includes(candidate);
}

// An import run with a scriptPath uses that file directly; without one, begin
// shows the import dialog (the flow band weighting and band selection keep).
// The Custom transform picks its file up front through the pick-script channel
// and runs at Apply time with the remembered path. A builtin run names one of
// the packaged Stage 6 algorithm scripts (CT-307); no dialog is shown.
export type UserScriptRunSource =
  | { readonly mode: "formula"; readonly expression: string }
  | { readonly mode: "import"; readonly scriptPath?: string }
  | { readonly mode: "builtin"; readonly scriptName: BuiltinScriptName };

// CT-307: parameters for one execute of a run session, JSON-safe by
// construction (they ride an IPC invoke and then the worker request frame).
export type UserScriptRunParams = Readonly<Record<string, unknown>>;

// CT-307: category masks ride the run session as raw uint8 bytes appended
// after the cube bytes on the SAME chunk channel (height/width come from the
// cube descriptor); the worker delivers them to the script as numpy arrays.
export interface UserScriptRunMasksDescriptor {
  readonly count: number;
}

// The product caps mask categories at 5; the protocol refuses anything larger
// so a harness bug cannot describe an absurd mask upload.
export const USER_SCRIPT_RUN_MAX_MASK_COUNT = 5;

export interface UserScriptRunProgressEvent {
  readonly token: string;
  readonly fraction: number;
}

export type UserScriptReadSourceResult =
  | { readonly status: "read"; readonly source: string }
  | { readonly status: "failed"; readonly message: string };

export type UserScriptPickScriptResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly filePath: string; readonly fileName: string };

export type UserScriptRunResultKind = "value" | "cube";

export interface UserScriptRunCubeDescriptor {
  readonly bandCount: number;
  readonly height: number;
  readonly width: number;
  readonly wavelengths: number[] | null;
}

export interface UserScriptRunBeginRequest {
  readonly source: UserScriptRunSource;
  readonly resultKind: UserScriptRunResultKind;
  readonly cube: UserScriptRunCubeDescriptor;
  // CT-307: when present, count * height * width mask bytes are expected on
  // the chunk channel AFTER the cube bytes.
  readonly masks?: UserScriptRunMasksDescriptor;
  // CT-335: a retained multi-execute session (the ROP aside) asks for a
  // RESIDENT worker: one interpreter loads the cube once in session mode and
  // answers every execute. Absent for one-shot runs, which spawn per execute.
  readonly residentWorker?: boolean;
}

export type UserScriptRunBeginResult =
  | { readonly status: "canceled" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly token: string; readonly sourceName: string | null };

export interface UserScriptRunCubeChunkRequest {
  readonly token: string;
  // Keep bytes the LAST field (the CT-219b serializer rule); chunks are small,
  // but the rule costs nothing and the shape may be copied elsewhere.
  readonly bytes: Uint8Array;
}

export interface UserScriptRunExecuteRequest {
  readonly token: string;
  // CT-307: per-execute parameters (a plain dict for the script's third
  // positional argument). A session can execute more than once against its
  // retained spooled cube, each time with fresh params (ROP's press-to-reroll).
  readonly params?: UserScriptRunParams;
}

// A completed cube run answers with the shape only; the band bytes are pulled
// afterwards through result chunks (they are as big as the uploaded cube).
export type UserScriptRunExecuteResult =
  | { readonly status: "completed"; readonly value: unknown }
  | {
      readonly status: "completed-cube";
      readonly shape: [number, number, number];
      readonly totalBytes: number;
    }
  | { readonly status: "failed"; readonly message: string };

export interface UserScriptRunResultChunkRequest {
  readonly token: string;
}

export interface UserScriptRunResultChunkResult {
  readonly done: boolean;
  readonly bytes: Uint8Array;
}

export interface UserScriptRunReleaseRequest {
  readonly token: string;
}

export interface UserScriptRunCancelRequest {
  readonly token: string;
}
