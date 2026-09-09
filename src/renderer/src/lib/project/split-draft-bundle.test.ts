import { describe, expect, it } from "vitest";

import type { BundleAssetPartEncodingPlan } from "@/lib/image/encode-bundle-asset";

import type { DraftBundleMaskLayer } from "./plan-mask-bundle-assets";
import { PROJECT_FILE_FORMAT_VERSION } from "./project-schema";
import type { DraftBundleFile, DraftBundleViewportEntry } from "./serialize-project";
import { splitDraftBundleForChunkedSave } from "./split-draft-bundle";

const RENDERING_STATE = {
  normalizationEnabled: false,
  selectedBandIndex: 0,
  lastAppliedOperationLabel: null,
};

function partPlanOf(extension: string, bytes: Uint8Array): BundleAssetPartEncodingPlan {
  return {
    extension,
    byteLength: bytes.byteLength,
    emitChunksInOrder: async (maxChunkBytes, onChunk) => {
      for (let offset = 0; offset < bytes.byteLength; offset += maxChunkBytes) {
        await onChunk(bytes.slice(offset, Math.min(offset + maxChunkBytes, bytes.byteLength)));
      }
    },
  };
}

function bakedEnviViewport(index: number): DraftBundleViewportEntry {
  return {
    index,
    fileName: `cube-${index}.hdr`,
    asset: {
      kind: "baked",
      primary: partPlanOf("hdr", Uint8Array.from([1, 2, 3])),
      sidecar: partPlanOf("bin", Uint8Array.from([4, 5, 6, 7])),
    },
    renderingState: RENDERING_STATE,
    operationHistory: [],
    masks: [],
    selectedMaskIndex: null,
    isOverlayVisible: true,
  };
}

function bakedTiffViewport(index: number): DraftBundleViewportEntry {
  return {
    index,
    fileName: `band-${index}.tif`,
    asset: { kind: "baked", primary: partPlanOf("tif", Uint8Array.from([9, 9])) },
    renderingState: RENDERING_STATE,
    operationHistory: [],
    masks: [],
    selectedMaskIndex: null,
    isOverlayVisible: true,
    colorInterpretation: "rgb",
  };
}

function externalViewport(index: number): DraftBundleViewportEntry {
  return {
    index,
    fileName: `photo-${index}.png`,
    asset: { kind: "external", absolutePath: `/abs/photo-${index}.png`, extension: "png" },
    renderingState: RENDERING_STATE,
    operationHistory: [],
    masks: [],
    selectedMaskIndex: null,
    isOverlayVisible: true,
  };
}

function maskLayerOf(
  name: string,
  categoryName: string,
  color: string,
  opacityPercent: number,
  bytes: Uint8Array,
): DraftBundleMaskLayer {
  return {
    name,
    width: 2,
    height: 2,
    categories: [{ name: categoryName, color }],
    opacityPercent,
    plan: partPlanOf("png", bytes),
  };
}

function viewportWithTwoMaskLayers(index: number): DraftBundleViewportEntry {
  return {
    ...externalViewport(index),
    masks: [
      maskLayerOf("Mask 1", "Foreground", "#ef4444", 60, Uint8Array.from([1, 2, 3])),
      maskLayerOf("Mask 2", "Background", "#3b82f6", 40, Uint8Array.from([1, 2, 3, 4, 5])),
    ],
    selectedMaskIndex: 1,
  };
}

function draftOf(viewports: ReadonlyArray<DraftBundleViewportEntry>): DraftBundleFile {
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "2x2",
    selectedViewportIndices: [0, 2],
    viewports,
  };
}

describe("splitDraftBundleForChunkedSave", () => {
  it("describes baked assets as byte-length descriptors and collects their plans as parts", () => {
    const split = splitDraftBundleForChunkedSave(
      draftOf([bakedEnviViewport(0), externalViewport(1), bakedTiffViewport(2)]),
    );
    expect(split.header.viewports[0]?.asset).toEqual({
      kind: "baked",
      primary: { extension: "hdr", byteLength: 3 },
      sidecar: { extension: "bin", byteLength: 4 },
    });
    expect(split.parts.map((part) => [part.viewportIndex, part.part, part.plan.byteLength])).toEqual([
      [0, "primary", 3],
      [0, "sidecar", 4],
      [2, "primary", 2],
    ]);
  });

  it("passes external assets through untouched and carries top-level draft fields", () => {
    const split = splitDraftBundleForChunkedSave(draftOf([externalViewport(1)]));
    expect(split.header.viewports[0]?.asset).toEqual({
      kind: "external",
      absolutePath: "/abs/photo-1.png",
      extension: "png",
    });
    expect(split.parts).toEqual([]);
    expect(split.header.formatVersion).toBe(PROJECT_FILE_FORMAT_VERSION);
    expect(split.header.gridLayout).toBe("2x2");
    expect(split.header.selectedViewportIndices).toEqual([0, 2]);
  });

  it("carries the rgb colour interpretation and omits it when absent", () => {
    const split = splitDraftBundleForChunkedSave(
      draftOf([bakedTiffViewport(0), bakedEnviViewport(1)]),
    );
    expect(split.header.viewports[0]?.colorInterpretation).toBe("rgb");
    expect(split.header.viewports[1]).not.toHaveProperty("colorInterpretation");
  });

  // CT-306: mask PNGs are extra upload parts of the same shape as a baked
  // stack part, keyed by the layer's position in the panel's mask list.
  it("collects one mask upload part per layer and describes it in the header", () => {
    const split = splitDraftBundleForChunkedSave(draftOf([viewportWithTwoMaskLayers(0)]));
    expect(split.parts.map((part) => [part.viewportIndex, part.part])).toEqual([
      [0, "mask-0"],
      [0, "mask-1"],
    ]);
    expect(split.header.viewports[0]?.masks?.[1]).toEqual({
      name: "Mask 2",
      width: 2,
      height: 2,
      categories: [{ name: "Background", color: "#3b82f6" }],
      opacityPercent: 40,
      byteLength: 5,
    });
  });

  it("carries the selected mask position in the header", () => {
    const split = splitDraftBundleForChunkedSave(draftOf([viewportWithTwoMaskLayers(0)]));
    expect(split.header.viewports[0]?.selectedMaskIndex).toBe(1);
  });

  // CT-342: the header is the only thing that reaches main, so the overlay
  // switch has to ride along with the mask parts.
  it("carries the mask overlay visibility in the header", () => {
    const hidden = { ...viewportWithTwoMaskLayers(0), isOverlayVisible: false };
    const split = splitDraftBundleForChunkedSave(draftOf([hidden, viewportWithTwoMaskLayers(1)]));
    expect(split.header.viewports.map((viewport) => viewport.isOverlayVisible)).toEqual([
      false,
      true,
    ]);
  });

  it("keeps the exact bytes reachable through the collected part plans", async () => {
    const split = splitDraftBundleForChunkedSave(draftOf([bakedEnviViewport(0)]));
    expect(Array.from(await emitAllBytes(split.parts[0]!.plan))).toEqual([1, 2, 3]);
    expect(Array.from(await emitAllBytes(split.parts[1]!.plan))).toEqual([4, 5, 6, 7]);
  });
});

async function emitAllBytes(plan: BundleAssetPartEncodingPlan): Promise<Uint8Array> {
  const collected = new Uint8Array(plan.byteLength);
  let offset = 0;
  await plan.emitChunksInOrder(2, async (bytes) => {
    collected.set(bytes, offset);
    offset += bytes.byteLength;
  });
  return collected;
}
