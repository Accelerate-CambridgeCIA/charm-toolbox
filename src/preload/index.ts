import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { readMemoryBudgetOverrideBytesFromArguments } from "../shared/e2e-memory-budget-argument";
import { readRopSeedOverrideFromArguments } from "../shared/e2e-rop-seed-argument";
import { readOpenedImageFileThroughChunkedProtocol } from "./chunked-opened-image-read-client";
import {
  OPENED_IMAGE_READ_ABORT_CHANNEL,
  OPENED_IMAGE_READ_BEGIN_CHANNEL,
  OPENED_IMAGE_READ_CHUNK_CHANNEL,
  OPENED_IMAGE_READ_FINISH_CHANNEL,
  type ChunkedOpenedImageReadAbortRequest,
  type ChunkedOpenedImageReadBeginRequest,
  type ChunkedOpenedImageReadBeginResult,
  type ChunkedOpenedImageReadChunkRequest,
  type ChunkedOpenedImageReadChunkResult,
  type ChunkedOpenedImageReadFinishRequest,
  type ChunkedOpenedImageReadFinishResult,
} from "../shared/chunked-opened-image-read-protocol";
import {
  PNG16_DECODE_ABORT_CHANNEL,
  PNG16_DECODE_BEGIN_CHANNEL,
  PNG16_DECODE_CHUNK_CHANNEL,
  PNG16_DECODE_FINISH_CHANNEL,
  type ChunkedPng16DecodeAbortRequest,
  type ChunkedPng16DecodeBeginRequest,
  type ChunkedPng16DecodeBeginResult,
  type ChunkedPng16DecodeChunkRequest,
  type ChunkedPng16DecodeChunkResult,
  type ChunkedPng16DecodeFinishRequest,
} from "../shared/chunked-png16-decode-protocol";
import {
  SAVE_BUNDLE_ASSET_CHUNK_CHANNEL,
  SAVE_BUNDLE_BEGIN_CHANNEL,
  SAVE_BUNDLE_FINISH_CHANNEL,
  SAVE_BUNDLE_RELEASE_CHANNEL,
  type SaveBundleAssetChunkRequest,
  type SaveBundleBeginRequest,
  type SaveBundleBeginResult,
  type SaveBundleFinishRequest,
  type SaveBundleFinishResult,
  type SaveBundleReleaseRequest,
} from "../shared/chunked-save-bundle-protocol";
import {
  SAVE_IMAGE_BEGIN_CHANNEL,
  SAVE_IMAGE_CHUNK_CHANNEL,
  SAVE_IMAGE_FINISH_CHANNEL,
  SAVE_IMAGE_RELEASE_CHANNEL,
  type SaveImageBeginRequest,
  type SaveImageBeginResult,
  type SaveImageChunkRequest,
  type SaveImageFinishRequest,
  type SaveImageFinishResult,
  type SaveImageReleaseRequest,
} from "../shared/chunked-save-image-protocol";
import {
  USER_SCRIPT_PICK_SCRIPT_CHANNEL,
  USER_SCRIPT_READ_SOURCE_CHANNEL,
  USER_SCRIPT_RUN_BEGIN_CHANNEL,
  USER_SCRIPT_RUN_CANCEL_CHANNEL,
  USER_SCRIPT_RUN_CUBE_CHUNK_CHANNEL,
  USER_SCRIPT_RUN_EXECUTE_CHANNEL,
  USER_SCRIPT_RUN_PROGRESS_CHANNEL,
  USER_SCRIPT_RUN_RELEASE_CHANNEL,
  USER_SCRIPT_RUN_RESULT_CHUNK_CHANNEL,
  type UserScriptPickScriptResult,
  type UserScriptReadSourceResult,
  type UserScriptRunBeginRequest,
  type UserScriptRunBeginResult,
  type UserScriptRunCancelRequest,
  type UserScriptRunCubeChunkRequest,
  type UserScriptRunExecuteRequest,
  type UserScriptRunExecuteResult,
  type UserScriptRunProgressEvent,
  type UserScriptRunReleaseRequest,
  type UserScriptRunResultChunkRequest,
  type UserScriptRunResultChunkResult,
} from "../shared/chunked-user-script-run-protocol";

export interface AppInfo {
  name: string;
  version: string;
}

export interface OpenImagesDialogFileMetadataEntry {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

export type OpenImagesDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<OpenImagesDialogFileMetadataEntry> };

// CT-234: the single-file dialog reply is metadata only; file bytes stream
// through the chunked-read wrappers below (same rule as the multi-file dialog).
export type OpenImageDialogResult =
  | { canceled: true }
  | { canceled: false; file: OpenImagesDialogFileMetadataEntry };

// CT-231: an ENVI header's binary sibling never crosses as assembled bytes;
// the renderer streams it through the chunked-read wrappers below, so the
// entry carries the picked file only.
export interface OpenedImagesFileEntry {
  fileName: string;
  filePath: string;
  bytes: Uint8Array;
  contentHash: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

// CT-303: the mask import dialog reply is metadata plus the small JSON
// sidecar; the PNG bytes stream through the chunked opened-image read.
// CT-328: the pick is a multi-selection of PNGs and zips, replied to in pick
// order; a zip carries its sidecar inside itself, so its sidecarText is null.
export interface PickedMaskFileDescription {
  file: OpenImagesDialogFileMetadataEntry;
  sidecarText: string | null;
}

export type MaskImportDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<PickedMaskFileDescription> };

export type OpenBundleDialogResult =
  | { canceled: true }
  | { canceled: false; projectFilePath: string; bytes: Uint8Array };

// CT-236: the bundle-asset reply is metadata only; asset bytes stream through
// the chunked-read wrappers below (same rule as the open-image dialogs).
export interface ResolveBundleAssetRequest {
  projectFilePath: string;
  relativePath: string;
}

export type ResolveBundleAssetResult =
  | { kind: "missing"; relativePath: string }
  | { kind: "found"; file: OpenImagesDialogFileMetadataEntry };

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeSnapshot {
  mode: ThemeMode;
  isDark: boolean;
}

export interface PythonEnvironmentSnapshot {
  ownInterpreterPath: string | null;
  pathExists: boolean;
}

export type MenuEventListener = () => void;
export type MenuCommandListener = (commandId: string) => void;
export type MenuGridLayoutListener = (layout: string) => void;
export type UnsubscribeMenuListener = () => void;
export type ThemeChangeListener = (snapshot: ThemeSnapshot) => void;
export type UnsubscribeThemeListener = () => void;

const GET_APP_INFO_CHANNEL = "app:get-info";
const OPEN_IMAGE_DIALOG_CHANNEL = "image:open-dialog";
const OPEN_IMAGES_DIALOG_CHANNEL = "image:open-images-dialog";
const MASK_IMPORT_DIALOG_CHANNEL = "mask:import-dialog";
const OPEN_BUNDLE_DIALOG_CHANNEL = "project:open-bundle-dialog";
const RESOLVE_BUNDLE_ASSET_CHANNEL = "project:resolve-bundle-asset";
const MENU_OPEN_IMAGE_CHANNEL = "menu:open-image";
const MENU_SAVE_IMAGE_CHANNEL = "menu:save-image";
const MENU_OPEN_PROJECT_CHANNEL = "menu:open-project";
const MENU_SAVE_PROJECT_CHANNEL = "menu:save-project";
const MENU_SAVE_PROJECT_AS_CHANNEL = "menu:save-project-as";
const MENU_ABOUT_CHANNEL = "menu:about";
const MENU_PYTHON_ENVIRONMENT_CHANNEL = "menu:python-environment";
const MENU_INVOKE_COMMAND_CHANNEL = "menu:invoke-command";
const MENU_SELECT_GRID_LAYOUT_CHANNEL = "menu:select-grid-layout";
const MENU_CLOSE_REQUESTED_CHANNEL = "menu:close-requested";
const APP_CONFIRM_CLOSE_CHANNEL = "app:confirm-close";
const THEME_GET_INITIAL_SYNC_CHANNEL = "theme:get-initial-sync";
const THEME_CHANGED_CHANNEL = "theme:changed";
const PYTHON_ENVIRONMENT_GET_CHANNEL = "python-environment:get";
const PYTHON_ENVIRONMENT_SET_CHANNEL = "python-environment:set";

function fetchAppInfoFromMainProcess(): Promise<AppInfo> {
  return ipcRenderer.invoke(GET_APP_INFO_CHANNEL) as Promise<AppInfo>;
}

function showOpenImageDialogThroughMainProcess(): Promise<OpenImageDialogResult> {
  return ipcRenderer.invoke(
    OPEN_IMAGE_DIALOG_CHANNEL,
  ) as Promise<OpenImageDialogResult>;
}

function showOpenImagesDialogThroughMainProcess(): Promise<OpenImagesDialogResult> {
  return ipcRenderer.invoke(
    OPEN_IMAGES_DIALOG_CHANNEL,
  ) as Promise<OpenImagesDialogResult>;
}

// CT-219b: file bytes stream from main in chunks; one whole-file IPC reply
// killed the main process for files of roughly 1 GiB and above.
function readSingleOpenedImageFileThroughMainProcess(
  metadata: OpenImagesDialogFileMetadataEntry,
): Promise<OpenedImagesFileEntry> {
  return readOpenedImageFileThroughChunkedProtocol(
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    metadata,
  );
}

// CT-231: the renderer drives the chunked read protocol directly for ENVI
// headers, feeding each 64 MiB binary chunk straight into the streaming
// decoder instead of assembling the whole multi-gigabyte sidecar.
function beginOpenedImageChunkedReadInMainProcess(
  request: ChunkedOpenedImageReadBeginRequest,
): Promise<ChunkedOpenedImageReadBeginResult> {
  return ipcRenderer.invoke(
    OPENED_IMAGE_READ_BEGIN_CHANNEL,
    request,
  ) as Promise<ChunkedOpenedImageReadBeginResult>;
}

function readOpenedImageChunkFromMainProcess(
  request: ChunkedOpenedImageReadChunkRequest,
): Promise<ChunkedOpenedImageReadChunkResult> {
  return ipcRenderer.invoke(
    OPENED_IMAGE_READ_CHUNK_CHANNEL,
    request,
  ) as Promise<ChunkedOpenedImageReadChunkResult>;
}

function finishOpenedImageChunkedReadInMainProcess(
  request: ChunkedOpenedImageReadFinishRequest,
): Promise<ChunkedOpenedImageReadFinishResult> {
  return ipcRenderer.invoke(
    OPENED_IMAGE_READ_FINISH_CHANNEL,
    request,
  ) as Promise<ChunkedOpenedImageReadFinishResult>;
}

function abortOpenedImageChunkedReadInMainProcess(
  request: ChunkedOpenedImageReadAbortRequest,
): Promise<void> {
  return ipcRenderer.invoke(
    OPENED_IMAGE_READ_ABORT_CHANNEL,
    request,
  ) as Promise<void>;
}

// CT-272: the renderer drives the chunked 16-bit PNG decode protocol; main
// re-reads the file from disk and streams back the DECODED big-endian
// samples, since Chromium's own PNG decoder downscales 16-bit data to 8 bits.
function beginPng16DecodeInMainProcess(
  request: ChunkedPng16DecodeBeginRequest,
): Promise<ChunkedPng16DecodeBeginResult> {
  return ipcRenderer.invoke(
    PNG16_DECODE_BEGIN_CHANNEL,
    request,
  ) as Promise<ChunkedPng16DecodeBeginResult>;
}

function readPng16DecodedChunkFromMainProcess(
  request: ChunkedPng16DecodeChunkRequest,
): Promise<ChunkedPng16DecodeChunkResult> {
  return ipcRenderer.invoke(
    PNG16_DECODE_CHUNK_CHANNEL,
    request,
  ) as Promise<ChunkedPng16DecodeChunkResult>;
}

function finishPng16DecodeInMainProcess(
  request: ChunkedPng16DecodeFinishRequest,
): Promise<void> {
  return ipcRenderer.invoke(PNG16_DECODE_FINISH_CHANNEL, request) as Promise<void>;
}

function abortPng16DecodeInMainProcess(
  request: ChunkedPng16DecodeAbortRequest,
): Promise<void> {
  return ipcRenderer.invoke(PNG16_DECODE_ABORT_CHANNEL, request) as Promise<void>;
}

// Chunked save-image protocol (CT-237, see
// src/shared/chunked-save-image-protocol.ts); these four thin wrappers keep
// every context-bridge crossing and invoke far below the serializer danger zone.
function beginSaveImageThroughMainProcess(
  request: SaveImageBeginRequest,
): Promise<SaveImageBeginResult> {
  return ipcRenderer.invoke(
    SAVE_IMAGE_BEGIN_CHANNEL,
    request,
  ) as Promise<SaveImageBeginResult>;
}

function sendSaveImageChunkToMainProcess(
  request: SaveImageChunkRequest,
): Promise<void> {
  return ipcRenderer.invoke(
    SAVE_IMAGE_CHUNK_CHANNEL,
    request,
  ) as Promise<void>;
}

function finishSaveImageInMainProcess(
  request: SaveImageFinishRequest,
): Promise<SaveImageFinishResult> {
  return ipcRenderer.invoke(
    SAVE_IMAGE_FINISH_CHANNEL,
    request,
  ) as Promise<SaveImageFinishResult>;
}

function releaseSaveImageInMainProcess(
  request: SaveImageReleaseRequest,
): Promise<void> {
  return ipcRenderer.invoke(
    SAVE_IMAGE_RELEASE_CHANNEL,
    request,
  ) as Promise<void>;
}

function showMaskImportDialogThroughMainProcess(): Promise<MaskImportDialogResult> {
  return ipcRenderer.invoke(MASK_IMPORT_DIALOG_CHANNEL) as Promise<MaskImportDialogResult>;
}

function showOpenBundleDialogThroughMainProcess(): Promise<OpenBundleDialogResult> {
  return ipcRenderer.invoke(
    OPEN_BUNDLE_DIALOG_CHANNEL,
  ) as Promise<OpenBundleDialogResult>;
}

function resolveBundleAssetThroughMainProcess(
  request: ResolveBundleAssetRequest,
): Promise<ResolveBundleAssetResult> {
  return ipcRenderer.invoke(
    RESOLVE_BUNDLE_ASSET_CHANNEL,
    request,
  ) as Promise<ResolveBundleAssetResult>;
}

// Chunked project-save protocol (CT-219e, see
// src/shared/chunked-save-bundle-protocol.ts); these four thin wrappers keep
// every context-bridge crossing and invoke far below the serializer danger zone.
function beginSaveBundleThroughMainProcess(
  request: SaveBundleBeginRequest,
): Promise<SaveBundleBeginResult> {
  return ipcRenderer.invoke(
    SAVE_BUNDLE_BEGIN_CHANNEL,
    request,
  ) as Promise<SaveBundleBeginResult>;
}

function sendSaveBundleAssetChunkToMainProcess(
  request: SaveBundleAssetChunkRequest,
): Promise<void> {
  return ipcRenderer.invoke(
    SAVE_BUNDLE_ASSET_CHUNK_CHANNEL,
    request,
  ) as Promise<void>;
}

function finishSaveBundleInMainProcess(
  request: SaveBundleFinishRequest,
): Promise<SaveBundleFinishResult> {
  return ipcRenderer.invoke(
    SAVE_BUNDLE_FINISH_CHANNEL,
    request,
  ) as Promise<SaveBundleFinishResult>;
}

function releaseSaveBundleInMainProcess(
  request: SaveBundleReleaseRequest,
): Promise<void> {
  return ipcRenderer.invoke(
    SAVE_BUNDLE_RELEASE_CHANNEL,
    request,
  ) as Promise<void>;
}

function subscribeToMenuChannel(
  channel: string,
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  const handler = (_event: IpcRendererEvent): void => listener();
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function subscribeToOpenImageMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_OPEN_IMAGE_CHANNEL, listener);
}

function subscribeToSaveImageMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_SAVE_IMAGE_CHANNEL, listener);
}

function subscribeToOpenProjectMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_OPEN_PROJECT_CHANNEL, listener);
}

function subscribeToSaveProjectMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_SAVE_PROJECT_CHANNEL, listener);
}

function subscribeToSaveProjectAsMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_SAVE_PROJECT_AS_CHANNEL, listener);
}

function subscribeToAboutMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_ABOUT_CHANNEL, listener);
}

// CT-258: main intercepts the window close event and asks the renderer; the
// renderer answers with confirmWindowClose once (or when the user decides).
function subscribeToWindowCloseRequestedEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_CLOSE_REQUESTED_CHANNEL, listener);
}

function confirmWindowCloseThroughMainProcess(): Promise<void> {
  return ipcRenderer.invoke(APP_CONFIRM_CLOSE_CHANNEL) as Promise<void>;
}

function subscribeToPythonEnvironmentMenuEvent(
  listener: MenuEventListener,
): UnsubscribeMenuListener {
  return subscribeToMenuChannel(MENU_PYTHON_ENVIRONMENT_CHANNEL, listener);
}

function fetchPythonEnvironmentFromMainProcess(): Promise<PythonEnvironmentSnapshot> {
  return ipcRenderer.invoke(
    PYTHON_ENVIRONMENT_GET_CHANNEL,
  ) as Promise<PythonEnvironmentSnapshot>;
}

function setPythonEnvironmentThroughMainProcess(
  ownInterpreterPath: string | null,
): Promise<PythonEnvironmentSnapshot> {
  return ipcRenderer.invoke(
    PYTHON_ENVIRONMENT_SET_CHANNEL,
    ownInterpreterPath,
  ) as Promise<PythonEnvironmentSnapshot>;
}

// CT-219g: the user-script cube crosses IPC chunked (see
// src/shared/chunked-user-script-run-protocol.ts); these five thin wrappers
// keep each context-bridge crossing and each invoke far below the size that
// wedged the renderer. The renderer orchestrator
// (lib/python/run-user-script-chunked.ts) drives the sequence.
function pickUserScriptFileThroughMainProcess(): Promise<UserScriptPickScriptResult> {
  return ipcRenderer.invoke(USER_SCRIPT_PICK_SCRIPT_CHANNEL) as Promise<UserScriptPickScriptResult>;
}

// CT-310: a picked objective script's source, read in main, so the ROP search
// can pass it as a run parameter and score every candidate with it.
function readUserScriptSourceThroughMainProcess(
  filePath: string,
): Promise<UserScriptReadSourceResult> {
  return ipcRenderer.invoke(
    USER_SCRIPT_READ_SOURCE_CHANNEL,
    filePath,
  ) as Promise<UserScriptReadSourceResult>;
}

function beginUserScriptRunThroughMainProcess(
  request: UserScriptRunBeginRequest,
): Promise<UserScriptRunBeginResult> {
  return ipcRenderer.invoke(
    USER_SCRIPT_RUN_BEGIN_CHANNEL,
    request,
  ) as Promise<UserScriptRunBeginResult>;
}

function sendUserScriptRunCubeChunkToMainProcess(
  request: UserScriptRunCubeChunkRequest,
): Promise<void> {
  return ipcRenderer.invoke(
    USER_SCRIPT_RUN_CUBE_CHUNK_CHANNEL,
    request,
  ) as Promise<void>;
}

function executeUserScriptRunInMainProcess(
  request: UserScriptRunExecuteRequest,
): Promise<UserScriptRunExecuteResult> {
  return ipcRenderer.invoke(
    USER_SCRIPT_RUN_EXECUTE_CHANNEL,
    request,
  ) as Promise<UserScriptRunExecuteResult>;
}

function readUserScriptRunResultChunkFromMainProcess(
  request: UserScriptRunResultChunkRequest,
): Promise<UserScriptRunResultChunkResult> {
  return ipcRenderer.invoke(
    USER_SCRIPT_RUN_RESULT_CHUNK_CHANNEL,
    request,
  ) as Promise<UserScriptRunResultChunkResult>;
}

function releaseUserScriptRunInMainProcess(
  request: UserScriptRunReleaseRequest,
): Promise<void> {
  return ipcRenderer.invoke(
    USER_SCRIPT_RUN_RELEASE_CHANNEL,
    request,
  ) as Promise<void>;
}

// CT-268: kills an executing run's Python worker subprocess (Stop button).
function cancelUserScriptRunInMainProcess(
  request: UserScriptRunCancelRequest,
): Promise<void> {
  return ipcRenderer.invoke(
    USER_SCRIPT_RUN_CANCEL_CHANNEL,
    request,
  ) as Promise<void>;
}

// CT-307: in-script progress frames pushed from main while a run executes;
// the renderer filters by run token.
function subscribeToUserScriptRunProgress(
  listener: (event: UserScriptRunProgressEvent) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, progress: UserScriptRunProgressEvent): void =>
    listener(progress);
  ipcRenderer.on(USER_SCRIPT_RUN_PROGRESS_CHANNEL, handler);
  return () => ipcRenderer.removeListener(USER_SCRIPT_RUN_PROGRESS_CHANNEL, handler);
}

function subscribeToInvokeCommandMenuEvent(
  listener: MenuCommandListener,
): UnsubscribeMenuListener {
  const handler = (_event: IpcRendererEvent, commandId: string): void =>
    listener(commandId);
  ipcRenderer.on(MENU_INVOKE_COMMAND_CHANNEL, handler);
  return () => ipcRenderer.removeListener(MENU_INVOKE_COMMAND_CHANNEL, handler);
}

// CT-289: the File > Grid submenu sends the chosen layout token ("1x2", ...).
function subscribeToSelectGridLayoutMenuEvent(
  listener: MenuGridLayoutListener,
): UnsubscribeMenuListener {
  const handler = (_event: IpcRendererEvent, layout: string): void =>
    listener(layout);
  ipcRenderer.on(MENU_SELECT_GRID_LAYOUT_CHANNEL, handler);
  return () => ipcRenderer.removeListener(MENU_SELECT_GRID_LAYOUT_CHANNEL, handler);
}

function readInitialThemeSnapshotSynchronously(): ThemeSnapshot {
  return ipcRenderer.sendSync(THEME_GET_INITIAL_SYNC_CHANNEL) as ThemeSnapshot;
}

function subscribeToThemeChanges(
  listener: ThemeChangeListener,
): UnsubscribeThemeListener {
  const handler = (_event: IpcRendererEvent, snapshot: ThemeSnapshot): void =>
    listener(snapshot);
  ipcRenderer.on(THEME_CHANGED_CHANNEL, handler);
  return () => ipcRenderer.removeListener(THEME_CHANGED_CHANNEL, handler);
}

const initialTheme = readInitialThemeSnapshotSynchronously();

const apiBridge = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getAppInfo: fetchAppInfoFromMainProcess,
  openImageDialog: showOpenImageDialogThroughMainProcess,
  openImagesDialog: showOpenImagesDialogThroughMainProcess,
  readOpenedImageFile: readSingleOpenedImageFileThroughMainProcess,
  beginOpenedImageChunkedRead: beginOpenedImageChunkedReadInMainProcess,
  readOpenedImageChunk: readOpenedImageChunkFromMainProcess,
  finishOpenedImageChunkedRead: finishOpenedImageChunkedReadInMainProcess,
  abortOpenedImageChunkedRead: abortOpenedImageChunkedReadInMainProcess,
  beginPng16Decode: beginPng16DecodeInMainProcess,
  readPng16DecodedChunk: readPng16DecodedChunkFromMainProcess,
  finishPng16Decode: finishPng16DecodeInMainProcess,
  abortPng16Decode: abortPng16DecodeInMainProcess,
  beginSaveImage: beginSaveImageThroughMainProcess,
  sendSaveImageChunk: sendSaveImageChunkToMainProcess,
  finishSaveImage: finishSaveImageInMainProcess,
  releaseSaveImage: releaseSaveImageInMainProcess,
  importMaskDialog: showMaskImportDialogThroughMainProcess,
  openProjectBundleDialog: showOpenBundleDialogThroughMainProcess,
  resolveProjectBundleAsset: resolveBundleAssetThroughMainProcess,
  beginSaveProjectBundle: beginSaveBundleThroughMainProcess,
  sendSaveProjectBundleAssetChunk: sendSaveBundleAssetChunkToMainProcess,
  finishSaveProjectBundle: finishSaveBundleInMainProcess,
  releaseSaveProjectBundle: releaseSaveBundleInMainProcess,
  onMenuOpenImage: subscribeToOpenImageMenuEvent,
  onMenuSaveImage: subscribeToSaveImageMenuEvent,
  onMenuOpenProject: subscribeToOpenProjectMenuEvent,
  onMenuSaveProject: subscribeToSaveProjectMenuEvent,
  onMenuSaveProjectAs: subscribeToSaveProjectAsMenuEvent,
  onMenuAbout: subscribeToAboutMenuEvent,
  onMenuPythonEnvironment: subscribeToPythonEnvironmentMenuEvent,
  onMenuInvokeCommand: subscribeToInvokeCommandMenuEvent,
  onMenuSelectGridLayout: subscribeToSelectGridLayoutMenuEvent,
  onWindowCloseRequested: subscribeToWindowCloseRequestedEvent,
  confirmWindowClose: confirmWindowCloseThroughMainProcess,
  getPythonEnvironment: fetchPythonEnvironmentFromMainProcess,
  setPythonEnvironment: setPythonEnvironmentThroughMainProcess,
  pickUserScriptFile: pickUserScriptFileThroughMainProcess,
  readUserScriptSource: readUserScriptSourceThroughMainProcess,
  beginUserScriptRun: beginUserScriptRunThroughMainProcess,
  sendUserScriptRunCubeChunk: sendUserScriptRunCubeChunkToMainProcess,
  executeUserScriptRun: executeUserScriptRunInMainProcess,
  readUserScriptRunResultChunk: readUserScriptRunResultChunkFromMainProcess,
  releaseUserScriptRun: releaseUserScriptRunInMainProcess,
  cancelUserScriptRun: cancelUserScriptRunInMainProcess,
  onUserScriptRunProgress: subscribeToUserScriptRunProgress,
  initialTheme,
  onThemeChange: subscribeToThemeChanges,
} as const;

export type ToolboxApi = typeof apiBridge;

contextBridge.exposeInMainWorld("toolboxApi", apiBridge);

// Keep this literal in sync with E2E_TEST_MODE_PRELOAD_ARGUMENT in src/main/e2e-dialog-stub.ts.
const E2E_TEST_MODE_PRELOAD_ARGUMENT = "--msi-e2e-test-mode";
const ENQUEUE_OPEN_DIALOG_PATHS_CHANNEL = "test:enqueue-open-dialog-paths";
const ENQUEUE_SAVE_DIALOG_PATH_CHANNEL = "test:enqueue-save-dialog-path";
const RESET_DIALOG_QUEUES_CHANNEL = "test:reset-dialog-queues";
// Keep in sync with src/main/e2e-python-observability.ts.
const READ_PYTHON_WORKER_SPAWN_COUNT_CHANNEL = "test:read-python-worker-spawn-count";

function isE2eTestModeEnabled(): boolean {
  return process.argv.includes(E2E_TEST_MODE_PRELOAD_ARGUMENT);
}

function enqueueOpenDialogPathsForTest(filePaths: ReadonlyArray<string>): Promise<void> {
  return ipcRenderer.invoke(ENQUEUE_OPEN_DIALOG_PATHS_CHANNEL, filePaths) as Promise<void>;
}

function enqueueSaveDialogPathForTest(filePath: string): Promise<void> {
  return ipcRenderer.invoke(ENQUEUE_SAVE_DIALOG_PATH_CHANNEL, filePath) as Promise<void>;
}

function resetDialogQueuesForTest(): Promise<void> {
  return ipcRenderer.invoke(RESET_DIALOG_QUEUES_CHANNEL) as Promise<void>;
}

// CT-335: how many Python interpreters main has spawned since launch
// (one-shot and resident alike), so a spec can prove the ROP session keeps
// one resident worker across presses.
function readPythonWorkerSpawnCountForTest(): Promise<number> {
  return ipcRenderer.invoke(READ_PYTHON_WORKER_SPAWN_COUNT_CHANNEL) as Promise<number>;
}

// CT-309: a forced ROP seed (see src/shared/e2e-rop-seed-argument.ts) so a
// projection press is reproducible against the pinned reference output.
// CT-316: a spec can change it at runtime (a second press with a different
// seed); the value lives here in the preload world, so the bridge exposes a
// reader and a writer rather than a snapshot.
let ropForcedSeedOverride = readRopSeedOverrideFromArguments(process.argv);

function readRopForcedSeedOverrideForTest(): number | null {
  return ropForcedSeedOverride;
}

function setRopForcedSeedOverrideForTest(seed: number | null): void {
  ropForcedSeedOverride = seed;
}

const e2eTestBridge = {
  enqueueOpenDialogPaths: enqueueOpenDialogPathsForTest,
  enqueueSaveDialogPath: enqueueSaveDialogPathForTest,
  resetDialogQueues: resetDialogQueuesForTest,
  // CT-260: a lowered raster-memory budget (see src/shared/e2e-memory-budget-argument.ts)
  // so e2e can trigger memory refusals with tiny fixtures.
  memoryBudgetOverrideBytes: readMemoryBudgetOverrideBytesFromArguments(process.argv),
  readRopForcedSeedOverride: readRopForcedSeedOverrideForTest,
  setRopForcedSeedOverride: setRopForcedSeedOverrideForTest,
  readPythonWorkerSpawnCount: readPythonWorkerSpawnCountForTest,
} as const;

export type ToolboxE2eBridge = typeof e2eTestBridge;

function exposeE2eTestBridgeWhenEnabled(): void {
  if (!isE2eTestModeEnabled()) return;
  contextBridge.exposeInMainWorld("toolboxE2E", e2eTestBridge);
}

exposeE2eTestBridgeWhenEnabled();
