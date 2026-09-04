import type { GridLayout } from "@/lib/grid/grid-layout";
import {
  planBakedBundleAssetEncodingForRasterSource,
  type BundleAssetPartEncodingPlan,
} from "@/lib/image/encode-bundle-asset";
import type { RasterColorInterpretation } from "@/lib/image/raster-image";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import { EMPTY_MASK_PANEL_STATE, type MaskPanelState } from "@/lib/masks/mask-panel";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  planMaskBundleAssetsForPanel,
  type DraftBundleMaskLayer,
} from "./plan-mask-bundle-assets";
import { findSelectedMaskLayerPositionOrNull } from "./project-mask-layers";
import {
  IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM,
  PROJECT_FILE_FORMAT_VERSION,
  type ProjectOperationHistoryEntry,
  type ProjectViewportRenderingState,
} from "./project-schema";

// CT-235: a baked draft asset carries chunk-emitting encoding PLANS, never whole
// asset bytes. Byte lengths are known up front (from the raster's dimensions);
// the bytes themselves are produced chunk-by-chunk during the upload phase of
// the chunked save protocol.
export interface DraftBundleBakedAsset {
  readonly kind: "baked";
  readonly primary: BundleAssetPartEncodingPlan;
  readonly sidecar?: BundleAssetPartEncodingPlan;
}

export interface DraftBundleExternalAsset {
  readonly kind: "external";
  readonly absolutePath: string;
  readonly extension: string;
}

export type DraftBundleAsset = DraftBundleBakedAsset | DraftBundleExternalAsset;

export interface DraftBundleViewportEntry {
  readonly index: number;
  readonly fileName: string;
  readonly asset: DraftBundleAsset;
  readonly renderingState: ProjectViewportRenderingState;
  readonly operationHistory: ReadonlyArray<ProjectOperationHistoryEntry>;
  readonly colorInterpretation?: RasterColorInterpretation;
  readonly masks: ReadonlyArray<DraftBundleMaskLayer>;
  readonly selectedMaskIndex: number | null;
  readonly isOverlayVisible: boolean;
}

export interface DraftBundleFile {
  readonly formatVersion: typeof PROJECT_FILE_FORMAT_VERSION;
  readonly gridLayout: GridLayout;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<DraftBundleViewportEntry>;
}

export interface SaveableViewportSnapshot {
  readonly index: number;
  readonly fileName: string;
  readonly source: ViewportImageSource;
  readonly originalFilePath: string | null;
  readonly renderingState: ProjectViewportRenderingState;
  readonly operationHistory: ReadonlyArray<ProjectOperationHistoryEntry>;
  // CT-306: the panel's mask layers, absent for a snapshot taken before masks
  // existed and empty for a panel the user never annotated.
  readonly masks?: MaskPanelState;
}

export interface SaveableProjectSnapshot {
  readonly gridLayout: GridLayout;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<SaveableViewportSnapshot>;
}

export async function buildDraftBundleFromSnapshot(
  snapshot: SaveableProjectSnapshot,
): Promise<DraftBundleFile> {
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: snapshot.gridLayout,
    selectedViewportIndices: [...snapshot.selectedViewportIndices].sort((a, b) => a - b),
    viewports: await Promise.all(
      snapshot.viewports.map(buildDraftBundleViewportEntryOrThrow),
    ),
  };
}

// CT-306: async only because a mask layer's PNG is encoded here (see
// plan-mask-bundle-assets.ts); the stack asset itself is still plan-only.
export async function buildDraftBundleViewportEntryOrThrow(
  viewport: SaveableViewportSnapshot,
): Promise<DraftBundleViewportEntry> {
  const masks = viewport.masks ?? EMPTY_MASK_PANEL_STATE;
  return {
    index: viewport.index,
    fileName: viewport.fileName,
    asset: buildDraftBundleAssetForViewportOrThrow(viewport),
    renderingState: viewport.renderingState,
    operationHistory: viewport.operationHistory,
    colorInterpretation: readPersistableColorInterpretationFromSource(viewport.source),
    masks: await planMaskBundleAssetsForPanel(masks),
    selectedMaskIndex: findSelectedMaskLayerPositionOrNull(masks),
    isOverlayVisible: masks.isOverlayVisible,
  };
}

// Persist the colour flag only for a genuine RGB composite (exactly three
// display channels). A scientific multi-band stack leaves it undefined, so the
// manifest stays free of the tag and the stack reopens with per-band viewing.
function readPersistableColorInterpretationFromSource(
  source: ViewportImageSource,
): RasterColorInterpretation | undefined {
  if (source.kind !== "raster") return undefined;
  return shouldRenderRasterAsRgbComposite(source.raster) ? "rgb" : undefined;
}

function buildDraftBundleAssetForViewportOrThrow(
  viewport: SaveableViewportSnapshot,
): DraftBundleAsset {
  if (canStreamUnmodifiedSourceFromDisk(viewport)) {
    return buildExternalAssetReferencingOriginalFile(viewport);
  }
  if (viewport.source.kind === "raster") {
    return planBakedBundleAssetEncodingForRasterSource(viewport.source.raster);
  }
  return buildExternalAssetForBrowserSourceOrThrow(viewport);
}

// Re-encoding (baking) a raster source is a CPU-bound, multi-second operation
// for large cubes, even chunked (CT-235). The save flow uses this to decide
// whether to let the busy indicator paint before that heavy work begins
// (CT-072), so a save that only references unmodified on-disk files stays as
// fast and flash-free as before.
export function saveableSnapshotRequiresRasterRebake(
  snapshot: SaveableProjectSnapshot,
): boolean {
  return snapshot.viewports.some(viewportRequiresRasterRebake);
}

function viewportRequiresRasterRebake(viewport: SaveableViewportSnapshot): boolean {
  if (canStreamUnmodifiedSourceFromDisk(viewport)) return false;
  return viewport.source.kind === "raster";
}

// Re-encoding a raster into the bundle costs a full chunked encode-and-upload
// pass (originally it materialised a second full-size copy and crashed the
// renderer for large ENVI cubes, CT-061). When the source is still the
// untouched on-disk file, reference it instead so the main process streams it
// straight from disk.
function canStreamUnmodifiedSourceFromDisk(
  viewport: SaveableViewportSnapshot,
): boolean {
  if (!viewport.originalFilePath) return false;
  return viewport.operationHistory.length === 0;
}

function buildExternalAssetReferencingOriginalFile(
  viewport: SaveableViewportSnapshot,
): DraftBundleExternalAsset {
  return {
    kind: "external",
    absolutePath: viewport.originalFilePath!,
    extension: extractFileExtensionWithoutLeadingDot(viewport.fileName),
  };
}

function buildExternalAssetForBrowserSourceOrThrow(
  viewport: SaveableViewportSnapshot,
): DraftBundleExternalAsset {
  if (!viewport.originalFilePath) {
    throw new Error(
      `Panel "${viewport.fileName}" has no on-disk source to pack into the bundle`,
    );
  }
  return buildExternalAssetReferencingOriginalFile(viewport);
}

function extractFileExtensionWithoutLeadingDot(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1);
}

export { IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM };
