interface ToolboxAppInfo {
  name: string;
  version: string;
}

// CT-234: the single-file dialog reply is metadata only; file bytes stream
// through the chunked-read methods below (same rule as the multi-file dialog).
type ToolboxOpenImageDialogResult =
  | { canceled: true }
  | { canceled: false; file: ToolboxOpenImagesDialogFileMetadataEntry };

interface ToolboxOpenImagesDialogFileMetadataEntry {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

type ToolboxOpenImagesDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<ToolboxOpenImagesDialogFileMetadataEntry> };

// CT-231: an ENVI header's binary sibling streams through the chunked-read
// methods below instead of arriving as assembled sidecar bytes.
interface ToolboxOpenedImagesFileEntry {
  fileName: string;
  filePath: string;
  bytes: Uint8Array;
  contentHash: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

// CT-231 chunked opened-image read protocol (mirrors
// src/shared/chunked-opened-image-read-protocol.ts; keep in sync).
interface ToolboxOpenedImageChunkedReadBeginRequest {
  filePath: string;
}

interface ToolboxOpenedImageChunkedReadSidecarInfo {
  fileName: string;
  sizeBytes: number;
}

interface ToolboxOpenedImageChunkedReadBeginResult {
  token: string;
  fileSizeBytes: number;
  sidecar: ToolboxOpenedImageChunkedReadSidecarInfo | null;
}

type ToolboxOpenedImageChunkedReadTarget = "file" | "sidecar";

interface ToolboxOpenedImageChunkedReadChunkRequest {
  token: string;
  target: ToolboxOpenedImageChunkedReadTarget;
}

interface ToolboxOpenedImageChunkedReadChunkResult {
  done: boolean;
  bytes: Uint8Array;
}

interface ToolboxOpenedImageChunkedReadFinishRequest {
  token: string;
}

interface ToolboxOpenedImageChunkedReadFinishResult {
  contentHash: string;
}

interface ToolboxOpenedImageChunkedReadAbortRequest {
  token: string;
}

// CT-272 chunked 16-bit PNG decode protocol (mirrors
// src/shared/chunked-png16-decode-protocol.ts; keep in sync).
interface ToolboxPng16DecodeBeginRequest {
  filePath: string;
}

interface ToolboxPng16DecodeBeginResult {
  token: string;
  width: number;
  height: number;
  channelCount: number;
}

interface ToolboxPng16DecodeChunkRequest {
  token: string;
}

interface ToolboxPng16DecodeChunkResult {
  done: boolean;
  bytes: Uint8Array;
}

interface ToolboxPng16DecodeFinishRequest {
  token: string;
}

interface ToolboxPng16DecodeAbortRequest {
  token: string;
}

// CT-303/CT-328: the mask import dialog reply is one entry per picked file, in
// pick order, each metadata plus the small JSON sidecar that sat beside it
// (mirrors MaskImportDialogResult in src/preload/index.ts).
interface ToolboxPickedMaskFileDescription {
  file: ToolboxOpenImagesDialogFileMetadataEntry;
  sidecarText: string | null;
}

type ToolboxMaskImportDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<ToolboxPickedMaskFileDescription> };

interface ToolboxSaveImageFileFilter {
  name: string;
  extensions: ReadonlyArray<string>;
}

// CT-237: the save-image export streams through the chunked protocol
// (src/shared/chunked-save-image-protocol.ts); no invoke carries the encoded
// payload whole. CT-273: folder exports address one part per band file.
type ToolboxSaveImagePart = "primary" | "sidecar" | `file-${number}`;

interface ToolboxSaveImageSidecarDescriptor {
  extension: string;
  byteLength: number;
}

// CT-271: 16-bit PNG encodes in MAIN from raw big-endian uint16 sample chunks.
interface ToolboxSaveImagePngSixteenBitGrayscaleEncoding {
  kind: "png-16-bit-grayscale";
  width: number;
  height: number;
}

interface ToolboxSaveImageSingleFileBeginRequest {
  suggestedFileName: string;
  fileFilter: ToolboxSaveImageFileFilter;
  primaryByteLength: number;
  primaryEncoding?: ToolboxSaveImagePngSixteenBitGrayscaleEncoding;
  sidecar?: ToolboxSaveImageSidecarDescriptor;
}

// CT-273: a folder export (PNG stack) begins with a directory pick; each
// file's chunks arrive under the part name "file-<index>".
interface ToolboxSaveImageFolderFileDescriptor {
  fileName: string;
  byteLength: number;
  encoding?: ToolboxSaveImagePngSixteenBitGrayscaleEncoding;
}

interface ToolboxSaveImageFolderBeginRequest {
  destination: "folder";
  files: ReadonlyArray<ToolboxSaveImageFolderFileDescriptor>;
}

type ToolboxSaveImageBeginRequest =
  | ToolboxSaveImageSingleFileBeginRequest
  | ToolboxSaveImageFolderBeginRequest;

type ToolboxSaveImageBeginResult =
  | { status: "canceled" }
  | { status: "ready"; token: string };

interface ToolboxSaveImageChunkRequest {
  token: string;
  part: ToolboxSaveImagePart;
  bytes: Uint8Array;
}

interface ToolboxSaveImageFinishRequest {
  token: string;
}

interface ToolboxSaveImageFinishResult {
  filePath: string;
}

interface ToolboxSaveImageReleaseRequest {
  token: string;
}

interface ToolboxSaveBundleDraftRenderingState {
  normalizationEnabled: boolean;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
}

type ToolboxSaveBundleDraftOperationHistoryParameterValue = number | string | boolean;

interface ToolboxSaveBundleDraftOperationHistoryEntry {
  actionId: string;
  actionLabel: string;
  appliedLabel: string;
  parameterValues: Readonly<
    Record<string, ToolboxSaveBundleDraftOperationHistoryParameterValue>
  >;
  timestampMs: number;
}

// Chunked project-save protocol (CT-219e), mirroring
// src/shared/chunked-save-bundle-protocol.ts: baked asset bytes cross as
// byte-length descriptors at begin and follow as small asset chunks.
// CT-306: mask layers add one "mask-<position>" part per layer on top of the
// stack's primary part and its optional sidecar.
type ToolboxSaveBundleAssetPart = "primary" | "sidecar" | `mask-${number}`;

interface ToolboxSaveBundleBakedPartDescriptor {
  extension: string;
  byteLength: number;
}

interface ToolboxSaveBundleBakedAssetDescriptor {
  kind: "baked";
  primary: ToolboxSaveBundleBakedPartDescriptor;
  sidecar?: ToolboxSaveBundleBakedPartDescriptor;
}

interface ToolboxSaveBundleExternalAssetDescriptor {
  kind: "external";
  absolutePath: string;
  extension: string;
}

type ToolboxSaveBundleAssetDescriptor =
  | ToolboxSaveBundleBakedAssetDescriptor
  | ToolboxSaveBundleExternalAssetDescriptor;

interface ToolboxSaveBundleMaskCategoryDescriptor {
  name: string;
  color: string;
}

interface ToolboxSaveBundleMaskLayerDescriptor {
  name: string;
  width: number;
  height: number;
  categories: ReadonlyArray<ToolboxSaveBundleMaskCategoryDescriptor>;
  opacityPercent: number;
  byteLength: number;
}

interface ToolboxSaveBundleViewportHeaderEntry {
  index: number;
  fileName: string;
  asset: ToolboxSaveBundleAssetDescriptor;
  renderingState: ToolboxSaveBundleDraftRenderingState;
  operationHistory: ReadonlyArray<ToolboxSaveBundleDraftOperationHistoryEntry>;
  colorInterpretation?: "rgb";
  masks?: ReadonlyArray<ToolboxSaveBundleMaskLayerDescriptor>;
  selectedMaskIndex?: number | null;
}

interface ToolboxSaveBundleDraftHeader {
  formatVersion: number;
  gridLayout: string;
  selectedViewportIndices: ReadonlyArray<number>;
  viewports: ReadonlyArray<ToolboxSaveBundleViewportHeaderEntry>;
}

interface ToolboxSaveBundleBeginRequest {
  header: ToolboxSaveBundleDraftHeader;
  currentProjectFilePath: string | null;
  saveAs: boolean;
}

type ToolboxSaveBundleBeginResult =
  | { status: "canceled" }
  | { status: "ready"; token: string };

interface ToolboxSaveBundleAssetChunkRequest {
  token: string;
  viewportIndex: number;
  part: ToolboxSaveBundleAssetPart;
  bytes: Uint8Array;
}

interface ToolboxSaveBundleFinishRequest {
  token: string;
}

interface ToolboxSaveBundleFinishResult {
  filePath: string;
}

interface ToolboxSaveBundleReleaseRequest {
  token: string;
}

type ToolboxOpenBundleDialogResult =
  | { canceled: true }
  | { canceled: false; projectFilePath: string; bytes: Uint8Array };

// CT-236: the bundle-asset reply is metadata only; asset bytes stream through
// the chunked opened-image read protocol like every other file open.
interface ToolboxResolveBundleAssetRequest {
  projectFilePath: string;
  relativePath: string;
}

type ToolboxResolveBundleAssetResult =
  | { kind: "missing"; relativePath: string }
  | { kind: "found"; file: ToolboxOpenImagesDialogFileMetadataEntry };

type ToolboxThemeMode = "system" | "light" | "dark";

interface ToolboxThemeSnapshot {
  mode: ToolboxThemeMode;
  isDark: boolean;
}

interface ToolboxPythonEnvironmentSnapshot {
  ownInterpreterPath: string | null;
  pathExists: boolean;
}

// CT-307: builtin names mirror BUILTIN_SCRIPT_NAMES in
// src/shared/chunked-user-script-run-protocol.ts; keep in sync.
type ToolboxBuiltinScriptName =
  | "npc"
  | "rop"
  | "rop_search"
  | "local_pca"
  | "local_mnf"
  | "l2_minimization";

type ToolboxRunUserScriptSource =
  | { mode: "formula"; expression: string }
  | { mode: "import"; scriptPath?: string }
  | { mode: "builtin"; scriptName: ToolboxBuiltinScriptName };

type ToolboxUserScriptPickResult =
  | { canceled: true }
  | { canceled: false; filePath: string; fileName: string };

type ToolboxUserScriptReadSourceResult =
  | { status: "read"; source: string }
  | { status: "failed"; message: string };

type ToolboxRunUserScriptResultKind = "value" | "cube";

// The assembled outcome of a chunked user-script run, produced by the renderer
// orchestrator (lib/python/run-user-script-chunked.ts), not by one IPC call.
type ToolboxRunUserScriptResult =
  | { status: "completed"; value: unknown; sourceName?: string }
  | { status: "completed-cube"; shape: number[]; bands: Float32Array[]; sourceName?: string }
  | { status: "canceled" }
  | { status: "failed"; message: string };

// CT-219g chunked user-script run protocol (mirrors
// src/shared/chunked-user-script-run-protocol.ts; keep in sync).
interface ToolboxUserScriptRunCubeDescriptor {
  bandCount: number;
  height: number;
  width: number;
  wavelengths: number[] | null;
}

interface ToolboxUserScriptRunBeginRequest {
  source: ToolboxRunUserScriptSource;
  resultKind: ToolboxRunUserScriptResultKind;
  cube: ToolboxUserScriptRunCubeDescriptor;
  // CT-307: when present, count * height * width mask bytes follow the cube
  // bytes on the chunk channel.
  masks?: { count: number };
  // CT-335: a retained multi-execute session asks main for a resident worker;
  // absent for one-shot runs, which spawn an interpreter per execute.
  residentWorker?: boolean;
}

type ToolboxUserScriptRunBeginResult =
  | { status: "canceled" }
  | { status: "failed"; message: string }
  | { status: "ready"; token: string; sourceName: string | null };

interface ToolboxUserScriptRunCubeChunkRequest {
  token: string;
  bytes: Uint8Array;
}

interface ToolboxUserScriptRunExecuteRequest {
  token: string;
  // CT-307: per-execute parameters for the script's third positional argument.
  params?: Record<string, unknown>;
}

// CT-307: in-script progress pushed from main while a run executes.
interface ToolboxUserScriptRunProgressEvent {
  token: string;
  fraction: number;
}

type ToolboxUserScriptRunExecuteResult =
  | { status: "completed"; value: unknown }
  | { status: "completed-cube"; shape: [number, number, number]; totalBytes: number }
  | { status: "failed"; message: string };

interface ToolboxUserScriptRunResultChunkRequest {
  token: string;
}

interface ToolboxUserScriptRunResultChunkResult {
  done: boolean;
  bytes: Uint8Array;
}

interface ToolboxUserScriptRunReleaseRequest {
  token: string;
}

interface ToolboxUserScriptRunCancelRequest {
  token: string;
}

type ToolboxMenuEventListener = () => void;
type ToolboxMenuCommandListener = (commandId: string) => void;
type ToolboxMenuGridLayoutListener = (layout: string) => void;
type ToolboxUnsubscribeMenuListener = () => void;
type ToolboxThemeChangeListener = (snapshot: ToolboxThemeSnapshot) => void;
type ToolboxUnsubscribeThemeListener = () => void;

type ToolboxPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

interface ToolboxApi {
  platform: ToolboxPlatform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  getAppInfo: () => Promise<ToolboxAppInfo>;
  openImageDialog: () => Promise<ToolboxOpenImageDialogResult>;
  openImagesDialog: () => Promise<ToolboxOpenImagesDialogResult>;
  readOpenedImageFile: (
    metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  ) => Promise<ToolboxOpenedImagesFileEntry>;
  beginOpenedImageChunkedRead: (
    request: ToolboxOpenedImageChunkedReadBeginRequest,
  ) => Promise<ToolboxOpenedImageChunkedReadBeginResult>;
  readOpenedImageChunk: (
    request: ToolboxOpenedImageChunkedReadChunkRequest,
  ) => Promise<ToolboxOpenedImageChunkedReadChunkResult>;
  finishOpenedImageChunkedRead: (
    request: ToolboxOpenedImageChunkedReadFinishRequest,
  ) => Promise<ToolboxOpenedImageChunkedReadFinishResult>;
  abortOpenedImageChunkedRead: (
    request: ToolboxOpenedImageChunkedReadAbortRequest,
  ) => Promise<void>;
  beginPng16Decode: (
    request: ToolboxPng16DecodeBeginRequest,
  ) => Promise<ToolboxPng16DecodeBeginResult>;
  readPng16DecodedChunk: (
    request: ToolboxPng16DecodeChunkRequest,
  ) => Promise<ToolboxPng16DecodeChunkResult>;
  finishPng16Decode: (request: ToolboxPng16DecodeFinishRequest) => Promise<void>;
  abortPng16Decode: (request: ToolboxPng16DecodeAbortRequest) => Promise<void>;
  beginSaveImage: (
    request: ToolboxSaveImageBeginRequest,
  ) => Promise<ToolboxSaveImageBeginResult>;
  sendSaveImageChunk: (request: ToolboxSaveImageChunkRequest) => Promise<void>;
  finishSaveImage: (
    request: ToolboxSaveImageFinishRequest,
  ) => Promise<ToolboxSaveImageFinishResult>;
  releaseSaveImage: (request: ToolboxSaveImageReleaseRequest) => Promise<void>;
  importMaskDialog: () => Promise<ToolboxMaskImportDialogResult>;
  openProjectBundleDialog: () => Promise<ToolboxOpenBundleDialogResult>;
  resolveProjectBundleAsset: (
    request: ToolboxResolveBundleAssetRequest,
  ) => Promise<ToolboxResolveBundleAssetResult>;
  beginSaveProjectBundle: (
    request: ToolboxSaveBundleBeginRequest,
  ) => Promise<ToolboxSaveBundleBeginResult>;
  sendSaveProjectBundleAssetChunk: (
    request: ToolboxSaveBundleAssetChunkRequest,
  ) => Promise<void>;
  finishSaveProjectBundle: (
    request: ToolboxSaveBundleFinishRequest,
  ) => Promise<ToolboxSaveBundleFinishResult>;
  releaseSaveProjectBundle: (
    request: ToolboxSaveBundleReleaseRequest,
  ) => Promise<void>;
  onMenuOpenImage: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuSaveImage: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuOpenProject: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuSaveProject: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuSaveProjectAs: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuAbout: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuPythonEnvironment: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuInvokeCommand: (
    listener: ToolboxMenuCommandListener,
  ) => ToolboxUnsubscribeMenuListener;
  onMenuSelectGridLayout: (
    listener: ToolboxMenuGridLayoutListener,
  ) => ToolboxUnsubscribeMenuListener;
  onWindowCloseRequested: (
    listener: ToolboxMenuEventListener,
  ) => ToolboxUnsubscribeMenuListener;
  confirmWindowClose: () => Promise<void>;
  getPythonEnvironment: () => Promise<ToolboxPythonEnvironmentSnapshot>;
  setPythonEnvironment: (
    ownInterpreterPath: string | null,
  ) => Promise<ToolboxPythonEnvironmentSnapshot>;
  pickUserScriptFile: () => Promise<ToolboxUserScriptPickResult>;
  readUserScriptSource: (filePath: string) => Promise<ToolboxUserScriptReadSourceResult>;
  beginUserScriptRun: (
    request: ToolboxUserScriptRunBeginRequest,
  ) => Promise<ToolboxUserScriptRunBeginResult>;
  sendUserScriptRunCubeChunk: (
    request: ToolboxUserScriptRunCubeChunkRequest,
  ) => Promise<void>;
  executeUserScriptRun: (
    request: ToolboxUserScriptRunExecuteRequest,
  ) => Promise<ToolboxUserScriptRunExecuteResult>;
  readUserScriptRunResultChunk: (
    request: ToolboxUserScriptRunResultChunkRequest,
  ) => Promise<ToolboxUserScriptRunResultChunkResult>;
  releaseUserScriptRun: (
    request: ToolboxUserScriptRunReleaseRequest,
  ) => Promise<void>;
  cancelUserScriptRun: (
    request: ToolboxUserScriptRunCancelRequest,
  ) => Promise<void>;
  onUserScriptRunProgress: (
    listener: (event: ToolboxUserScriptRunProgressEvent) => void,
  ) => () => void;
  initialTheme: ToolboxThemeSnapshot;
  onThemeChange: (
    listener: ToolboxThemeChangeListener,
  ) => ToolboxUnsubscribeThemeListener;
}

interface Window {
  toolboxApi: ToolboxApi;
}
