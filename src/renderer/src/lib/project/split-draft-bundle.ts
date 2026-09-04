import { buildMaskAssetPartKey } from "@shared/chunked-save-bundle-protocol";

import type { BundleAssetPartEncodingPlan } from "@/lib/image/encode-bundle-asset";

import type { DraftBundleMaskLayer } from "./plan-mask-bundle-assets";
import type { DraftBundleAsset, DraftBundleFile, DraftBundleViewportEntry } from "./serialize-project";

// CT-219e: baked asset bytes must never cross IPC inside one payload (the
// whole-draft invoke killed the renderer at reference scale; see
// src/shared/chunked-save-bundle-protocol.ts). CT-235 removed the renderer-side
// whole-asset buffers too: the draft carries chunk-emitting encoding plans, so
// this split turns a draft into the byte-free header the begin request carries
// plus the list of baked parts whose bytes are ENCODED AND UPLOADED chunk by
// chunk afterwards. CT-306: a viewport's mask PNGs are extra upload parts of
// exactly the same shape, so masks ride the protocol without widening it.

export interface SaveBundleUploadPart {
  readonly viewportIndex: number;
  readonly part: ToolboxSaveBundleAssetPart;
  readonly plan: BundleAssetPartEncodingPlan;
}

export interface SplitDraftBundle {
  readonly header: ToolboxSaveBundleDraftHeader;
  readonly parts: ReadonlyArray<SaveBundleUploadPart>;
}

export function splitDraftBundleForChunkedSave(draft: DraftBundleFile): SplitDraftBundle {
  const parts: SaveBundleUploadPart[] = [];
  const viewports = draft.viewports.map((viewport) =>
    describeViewportCollectingUploadParts(viewport, parts),
  );
  return { header: buildHeaderFromDraft(draft, viewports), parts };
}

function describeViewportCollectingUploadParts(
  viewport: DraftBundleViewportEntry,
  parts: SaveBundleUploadPart[],
): ToolboxSaveBundleViewportHeaderEntry {
  return {
    index: viewport.index,
    fileName: viewport.fileName,
    asset: describeAssetCollectingUploadParts(viewport.asset, viewport.index, parts),
    renderingState: viewport.renderingState,
    operationHistory: viewport.operationHistory,
    masks: describeMasksCollectingUploadParts(viewport.masks, viewport.index, parts),
    selectedMaskIndex: viewport.selectedMaskIndex,
    isOverlayVisible: viewport.isOverlayVisible,
    ...(viewport.colorInterpretation === "rgb" ? { colorInterpretation: "rgb" as const } : {}),
  };
}

function buildHeaderFromDraft(
  draft: DraftBundleFile,
  viewports: ReadonlyArray<ToolboxSaveBundleViewportHeaderEntry>,
): ToolboxSaveBundleDraftHeader {
  return {
    formatVersion: draft.formatVersion,
    gridLayout: draft.gridLayout,
    selectedViewportIndices: draft.selectedViewportIndices,
    viewports,
  };
}

function describeAssetCollectingUploadParts(
  asset: DraftBundleAsset,
  viewportIndex: number,
  parts: SaveBundleUploadPart[],
): ToolboxSaveBundleAssetDescriptor {
  if (asset.kind === "external") return asset;
  parts.push({ viewportIndex, part: "primary", plan: asset.primary });
  if (asset.sidecar) parts.push({ viewportIndex, part: "sidecar", plan: asset.sidecar });
  return {
    kind: "baked",
    primary: { extension: asset.primary.extension, byteLength: asset.primary.byteLength },
    ...(asset.sidecar
      ? {
          sidecar: {
            extension: asset.sidecar.extension,
            byteLength: asset.sidecar.byteLength,
          },
        }
      : {}),
  };
}

function describeMasksCollectingUploadParts(
  masks: ReadonlyArray<DraftBundleMaskLayer>,
  viewportIndex: number,
  parts: SaveBundleUploadPart[],
): ReadonlyArray<ToolboxSaveBundleMaskLayerDescriptor> {
  return masks.map((mask, position) => {
    parts.push({ viewportIndex, part: buildMaskAssetPartKey(position), plan: mask.plan });
    return describeMaskLayerForHeader(mask);
  });
}

function describeMaskLayerForHeader(
  mask: DraftBundleMaskLayer,
): ToolboxSaveBundleMaskLayerDescriptor {
  return {
    name: mask.name,
    width: mask.width,
    height: mask.height,
    categories: mask.categories.map((category) => ({
      name: category.name,
      color: category.color,
    })),
    opacityPercent: mask.opacityPercent,
    byteLength: mask.plan.byteLength,
  };
}
