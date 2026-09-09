// Chunked project-save protocol (CT-219e), shared between the main process
// handlers (src/main/save-bundle-dialog.ts + chunked-save-bundle.ts), the
// preload bridge, and the renderer orchestrator
// (src/renderer/src/lib/project/run-save-bundle-flow.ts).
//
// WHY CHUNKS: the old project:save-bundle-dialog channel carried the WHOLE
// BundleDraft, including every baked asset's bytes (~1.5 GB for a modified
// reference-scale stack), in ONE ipcRenderer.invoke. Serializing a
// multi-gigabyte structured-clone payload kills the SENDING renderer process
// once V8's ValueSerializer wire buffer doubles past Chromium's 2 GiB
// PartitionAlloc single-allocation cap (the CT-219b/CT-219g mechanism; see
// chunked-opened-image-read-protocol.ts for the canonical explanation). The
// save died with no toast, no error, and no file. Streaming each baked asset
// up in small sequential chunks keeps every IPC message far below the danger
// zone at any stack size, and the awaits between chunks keep the renderer
// interactive.
//
// FLOW: begin (resolves the save dialog BEFORE any asset bytes move, so a
// cancel uploads nothing) -> N asset-chunk uploads per baked asset part ->
// finish (writes the .ctbundle zip from the spooled parts) -> release
// (renderer-side failure cleanup; finish releases on its own).

export const SAVE_BUNDLE_BEGIN_CHANNEL = "project:save-bundle-begin";
export const SAVE_BUNDLE_ASSET_CHUNK_CHANNEL = "project:save-bundle-asset-chunk";
export const SAVE_BUNDLE_FINISH_CHANNEL = "project:save-bundle-finish";
export const SAVE_BUNDLE_RELEASE_CHANNEL = "project:save-bundle-release";

export const SAVE_BUNDLE_CHUNK_BYTES = 64 * 1024 * 1024;

export type SaveBundleOperationHistoryParameterValue = number | string | boolean;

export interface SaveBundleOperationHistoryEntry {
  readonly actionId: string;
  readonly actionLabel: string;
  readonly appliedLabel: string;
  readonly parameterValues: Readonly<
    Record<string, SaveBundleOperationHistoryParameterValue>
  >;
  readonly timestampMs: number;
}

export interface SaveBundleViewportRenderingState {
  readonly normalizationEnabled: boolean;
  readonly selectedBandIndex: number;
  readonly lastAppliedOperationLabel: string | null;
}

// CT-306: a viewport no longer has a fixed two-part asset shape. Alongside the
// stack's primary part (and an ENVI .bin sidecar) it may carry one mask PNG per
// mask layer, addressed as "mask-0", "mask-1", and so on by the layer's
// position in the panel's mask list.
export type SaveBundleAssetPart = "primary" | "sidecar" | `mask-${number}`;

export function buildMaskAssetPartKey(maskPosition: number): SaveBundleAssetPart {
  return `mask-${maskPosition}`;
}

// A baked asset crosses as a byte-length DESCRIPTOR here; its bytes follow
// separately as asset chunks and spool to a temp file in main.
export interface SaveBundleBakedPartDescriptor {
  readonly extension: string;
  readonly byteLength: number;
}

export interface SaveBundleBakedAssetDescriptor {
  readonly kind: "baked";
  readonly primary: SaveBundleBakedPartDescriptor;
  readonly sidecar?: SaveBundleBakedPartDescriptor;
}

export interface SaveBundleExternalAssetDescriptor {
  readonly kind: "external";
  readonly absolutePath: string;
  readonly extension: string;
}

export type SaveBundleAssetDescriptor =
  | SaveBundleBakedAssetDescriptor
  | SaveBundleExternalAssetDescriptor;

// CT-306: a mask layer's labelling travels in the header and its category
// indexes follow as a PNG upload part, exactly like a baked stack part.
export interface SaveBundleMaskCategoryDescriptor {
  readonly name: string;
  readonly color: string;
}

export interface SaveBundleMaskLayerDescriptor {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly categories: ReadonlyArray<SaveBundleMaskCategoryDescriptor>;
  readonly opacityPercent: number;
  readonly byteLength: number;
}

export interface SaveBundleViewportHeaderEntry {
  readonly index: number;
  readonly fileName: string;
  readonly asset: SaveBundleAssetDescriptor;
  readonly renderingState: SaveBundleViewportRenderingState;
  readonly operationHistory: ReadonlyArray<SaveBundleOperationHistoryEntry>;
  readonly colorInterpretation?: "rgb";
  readonly masks?: ReadonlyArray<SaveBundleMaskLayerDescriptor>;
  readonly selectedMaskIndex?: number | null;
  readonly isOverlayVisible?: boolean;
}

export interface SaveBundleDraftHeader {
  readonly formatVersion: number;
  readonly gridLayout: string;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<SaveBundleViewportHeaderEntry>;
}

export interface SaveBundleBeginRequest {
  readonly header: SaveBundleDraftHeader;
  readonly currentProjectFilePath: string | null;
  readonly saveAs: boolean;
}

export type SaveBundleBeginResult =
  | { readonly status: "canceled" }
  | { readonly status: "ready"; readonly token: string };

export interface SaveBundleAssetChunkRequest {
  readonly token: string;
  readonly viewportIndex: number;
  readonly part: SaveBundleAssetPart;
  // Keep bytes the LAST field (the CT-219b serializer rule); chunks are small,
  // but the rule costs nothing and the shape may be copied elsewhere.
  readonly bytes: Uint8Array;
}

export interface SaveBundleFinishRequest {
  readonly token: string;
}

// A finish failure rejects the invoke; the renderer surfaces the message.
export interface SaveBundleFinishResult {
  readonly filePath: string;
}

export interface SaveBundleReleaseRequest {
  readonly token: string;
}
