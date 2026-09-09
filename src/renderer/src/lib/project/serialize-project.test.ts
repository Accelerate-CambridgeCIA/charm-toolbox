import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import { hideMaskOverlay, type MaskPanelState } from "@/lib/masks/mask-panel";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { PROJECT_FILE_FORMAT_VERSION } from "./project-schema";
import {
  buildDraftBundleFromSnapshot,
  saveableSnapshotRequiresRasterRebake,
  type SaveableProjectSnapshot,
} from "./serialize-project";

describe("buildDraftBundleFromSnapshot", () => {
  it("emits the supported format version constant", async () => {
    const draft = await buildDraftBundleFromSnapshot(buildSingleViewportSnapshot());
    expect(draft.formatVersion).toBe(PROJECT_FILE_FORMAT_VERSION);
  });

  it("bakes a modified raster source as a single-band TIFF encoding plan", async () => {
    const draft = await buildDraftBundleFromSnapshot(withAppliedOperation(buildSingleViewportSnapshot()));
    const [first] = draft.viewports;
    expect(first?.asset.kind).toBe("baked");
    if (first?.asset.kind !== "baked") return;
    expect(first.asset.primary.extension).toBe("tif");
    expect(first.asset.sidecar).toBeUndefined();
    expect(first.asset.primary.byteLength).toBeGreaterThan(0);
  });

  it("bakes a modified multi-band raster source as an ENVI plan with a .bin sidecar", async () => {
    const draft = await buildDraftBundleFromSnapshot(withAppliedOperation(buildMultiBandRasterSnapshot()));
    const [first] = draft.viewports;
    expect(first?.asset.kind).toBe("baked");
    if (first?.asset.kind !== "baked") return;
    expect(first.asset.primary.extension).toBe("hdr");
    expect(first.asset.sidecar?.extension).toBe("bin");
    expect(first.asset.sidecar?.byteLength).toBeGreaterThan(0);
  });

  it("references an unmodified on-disk raster as an external asset instead of baking it", async () => {
    const draft = await buildDraftBundleFromSnapshot(buildMultiBandRasterSnapshot());
    const [first] = draft.viewports;
    expect(first?.asset.kind).toBe("external");
    if (first?.asset.kind !== "external") return;
    expect(first.asset.absolutePath).toBe("/abs/path/to/cube.hdr");
    expect(first.asset.extension).toBe("hdr");
  });

  // CT-061: a large unmodified ENVI cube must never be re-encoded into renderer
  // memory or cloned across IPC. The external path declares the source by path
  // and reads no pixels, so a cube with huge declared dimensions packs without
  // allocating anything.
  it("streams a large unmodified ENVI cube by reference without baking it", async () => {
    const snapshot = buildLargeUnmodifiedEnviSnapshot();
    const draft = await buildDraftBundleFromSnapshot(snapshot);
    expect(draft.viewports[0]?.asset.kind).toBe("external");
  });

  // CT-235: the 1.8 GB bake cap is gone. A modified multi-gigabyte cube plans a
  // chunked bake (metadata only, nothing allocated) instead of being rejected.
  it("plans a chunked bake for a modified raster beyond the old bake size limit", async () => {
    const snapshot = withAppliedOperation(buildLargeUnmodifiedEnviSnapshot());
    const draft = await buildDraftBundleFromSnapshot(snapshot);
    const [first] = draft.viewports;
    expect(first?.asset.kind).toBe("baked");
    if (first?.asset.kind !== "baked") return;
    expect(first.asset.sidecar?.byteLength).toBe(20_000 * 20_000 * 10 * 2);
  });

  it("sorts the selected viewport indices ascending", async () => {
    const snapshot: SaveableProjectSnapshot = {
      ...buildSingleViewportSnapshot(),
      selectedViewportIndices: [3, 1, 2],
    };
    const draft = await buildDraftBundleFromSnapshot(snapshot);
    expect(draft.selectedViewportIndices).toEqual([1, 2, 3]);
  });

  it("forwards rendering state values onto each viewport entry", async () => {
    const draft = await buildDraftBundleFromSnapshot(buildSingleViewportSnapshot());
    const [first] = draft.viewports;
    expect(first?.renderingState.normalizationEnabled).toBe(true);
    expect(first?.renderingState.selectedBandIndex).toBe(0);
    expect(first?.renderingState.lastAppliedOperationLabel).toBeNull();
  });

  it("tags a true-colour composite viewport with the rgb colour interpretation", async () => {
    const draft = await buildDraftBundleFromSnapshot(
      withAppliedOperation(buildRgbCompositeRasterSnapshot()),
    );
    expect(draft.viewports[0]?.colorInterpretation).toBe("rgb");
  });

  it("leaves the colour interpretation absent for a scientific multi-band stack", async () => {
    const draft = await buildDraftBundleFromSnapshot(withAppliedOperation(buildMultiBandRasterSnapshot()));
    expect(draft.viewports[0]?.colorInterpretation).toBeUndefined();
  });

  it("leaves the colour interpretation absent for a single-band raster", async () => {
    const draft = await buildDraftBundleFromSnapshot(withAppliedOperation(buildSingleViewportSnapshot()));
    expect(draft.viewports[0]?.colorInterpretation).toBeUndefined();
  });

  it("forwards each viewport's operationHistory entries unchanged", async () => {
    const snapshot: SaveableProjectSnapshot = {
      ...buildSingleViewportSnapshot(),
      viewports: [
        {
          ...buildSingleViewportSnapshot().viewports[0]!,
          operationHistory: [
            {
              actionId: "bit-shift",
              actionLabel: "Bit Shift",
              appliedLabel: "Bit shift +4",
              parameterValues: { shiftAmount: 4 },
              timestampMs: 1_700_000_000_000,
            },
          ],
        },
      ],
    };
    const draft = await buildDraftBundleFromSnapshot(snapshot);
    expect(draft.viewports[0]?.operationHistory).toHaveLength(1);
    expect(draft.viewports[0]?.operationHistory[0]?.actionId).toBe("bit-shift");
    expect(draft.viewports[0]?.operationHistory[0]?.parameterValues).toEqual({ shiftAmount: 4 });
  });

  // CT-306: a panel with no masks must not add anything to the bundle, so a
  // pre-mask project keeps saving exactly the assets it always did.
  it("plans no mask assets for a panel that was never annotated", async () => {
    const draft = await buildDraftBundleFromSnapshot(buildSingleViewportSnapshot());
    expect(draft.viewports[0]?.masks).toEqual([]);
    expect(draft.viewports[0]?.selectedMaskIndex).toBeNull();
  });

  it("plans one PNG asset per mask layer and records the selected layer's position", async () => {
    const draft = await buildDraftBundleFromSnapshot(withTwoMaskLayersSelectingTheSecond());
    const masks = draft.viewports[0]?.masks ?? [];
    expect(masks.map((mask) => [mask.name, mask.plan.extension])).toEqual([
      ["Mask 1", "png"],
      ["Mask 2", "png"],
    ]);
    expect(masks[0]?.categories).toEqual([{ name: "Foreground", color: "#ef4444" }]);
    expect(masks[0]?.opacityPercent).toBe(75);
    expect(draft.viewports[0]?.selectedMaskIndex).toBe(1);
  });

  // CT-342: the panel's overlay switch is part of what a project remembers, so
  // a mask the user hid stays hidden when the bundle is reopened.
  it("records the panel's mask overlay visibility", async () => {
    const visible = await buildDraftBundleFromSnapshot(withTwoMaskLayersSelectingTheSecond());
    expect(visible.viewports[0]?.isOverlayVisible).toBe(true);
    const hidden = await buildDraftBundleFromSnapshot(withTheMaskOverlayHidden());
    expect(hidden.viewports[0]?.isOverlayVisible).toBe(false);
  });

  it("plans mask asset bytes that decode back to the painted category indexes", async () => {
    const draft = await buildDraftBundleFromSnapshot(withTwoMaskLayersSelectingTheSecond());
    const plan = draft.viewports[0]!.masks[0]!.plan;
    const decoded = await decodeMaskPngBytes(await collectPlanBytes(plan));
    expect(Array.from(decoded.values)).toEqual([0, 1, 1, 0]);
    expect([decoded.width, decoded.height]).toEqual([2, 2]);
  });
});

function withTwoMaskLayersSelectingTheSecond(): SaveableProjectSnapshot {
  const base = buildSingleViewportSnapshot();
  return {
    ...base,
    viewports: [{ ...base.viewports[0]!, masks: buildTwoMaskLayerPanel() }],
  };
}

function withTheMaskOverlayHidden(): SaveableProjectSnapshot {
  const base = buildSingleViewportSnapshot();
  const masks = hideMaskOverlay(buildTwoMaskLayerPanel());
  return { ...base, viewports: [{ ...base.viewports[0]!, masks }] };
}

function buildTwoMaskLayerPanel(): MaskPanelState {
  return {
    layers: [
      buildMaskLayerFixture("mask-1", "Mask 1", Uint8Array.from([0, 1, 1, 0]), 75),
      buildMaskLayerFixture("mask-2", "Mask 2", Uint8Array.from([2, 2, 0, 0]), 30),
    ],
    selectedLayerId: "mask-2",
    isOverlayVisible: true,
  };
}

function buildMaskLayerFixture(
  id: string,
  name: string,
  values: Uint8Array,
  opacityPercent: number,
): MaskLayer {
  return {
    id,
    name,
    width: 2,
    height: 2,
    values,
    categories: [{ id: "category-1", name: "Foreground", color: "#ef4444" }],
    opacityPercent,
  };
}

async function collectPlanBytes(plan: {
  byteLength: number;
  emitChunksInOrder: (
    maxChunkBytes: number,
    onChunk: (bytes: Uint8Array) => Promise<void>,
  ) => Promise<void>;
}): Promise<Uint8Array> {
  const collected = new Uint8Array(plan.byteLength);
  let offset = 0;
  await plan.emitChunksInOrder(8, async (bytes) => {
    collected.set(bytes, offset);
    offset += bytes.byteLength;
  });
  return collected;
}

// CT-072: the save flow waits for the busy indicator to paint before the heavy
// raster bake, but only when a bake will actually happen. An all-external save
// must report no rebake so it stays fast and flash-free.
describe("saveableSnapshotRequiresRasterRebake", () => {
  it("reports a rebake when a modified raster source must be re-encoded", () => {
    const snapshot = withAppliedOperation(buildSingleViewportSnapshot());
    expect(saveableSnapshotRequiresRasterRebake(snapshot)).toBe(true);
  });

  it("reports no rebake for an unmodified on-disk raster streamed by reference", () => {
    expect(saveableSnapshotRequiresRasterRebake(buildMultiBandRasterSnapshot())).toBe(false);
  });

  it("reports no rebake for a large unmodified ENVI cube streamed by reference", () => {
    expect(saveableSnapshotRequiresRasterRebake(buildLargeUnmodifiedEnviSnapshot())).toBe(false);
  });

  it("reports a rebake when any viewport in a multi-viewport save was modified", () => {
    const unmodified = buildSingleViewportSnapshot().viewports[0]!;
    const modified = withAppliedOperation(buildMultiBandRasterSnapshot()).viewports[0]!;
    const snapshot: SaveableProjectSnapshot = {
      ...buildSingleViewportSnapshot(),
      viewports: [unmodified, { ...modified, index: 1 }],
    };
    expect(saveableSnapshotRequiresRasterRebake(snapshot)).toBe(true);
  });
});

function buildSingleViewportSnapshot(): SaveableProjectSnapshot {
  return {
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        fileName: "sample.tif",
        source: buildSingleBandRasterSource(),
        originalFilePath: "/abs/path/to/sample.tif",
        renderingState: {
          normalizationEnabled: true,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
      },
    ],
  };
}

function buildMultiBandRasterSnapshot(): SaveableProjectSnapshot {
  return {
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        fileName: "cube.hdr",
        source: buildMultiBandRasterSource(),
        originalFilePath: "/abs/path/to/cube.hdr",
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
      },
    ],
  };
}

function withAppliedOperation(
  snapshot: SaveableProjectSnapshot,
): SaveableProjectSnapshot {
  return {
    ...snapshot,
    viewports: snapshot.viewports.map((viewport) => ({
      ...viewport,
      operationHistory: [
        {
          actionId: "bit-shift",
          actionLabel: "Bit Shift",
          appliedLabel: "Bit shift +4",
          parameterValues: { shiftAmount: 4 },
          timestampMs: 1_700_000_000_000,
        },
      ],
    })),
  };
}

function buildLargeUnmodifiedEnviSnapshot(): SaveableProjectSnapshot {
  const base = buildMultiBandRasterSnapshot();
  const viewport = base.viewports[0]!;
  const source = viewport.source as Extract<ViewportImageSource, { kind: "raster" }>;
  return {
    ...base,
    viewports: [
      {
        ...viewport,
        source: { kind: "raster", raster: { ...source.raster, width: 20_000, height: 20_000, bandCount: 10 } },
      },
    ],
  };
}

function buildSingleBandRasterSource(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: [new Uint16Array([0, 1, 2, 3])],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
  return { kind: "raster", raster };
}

function buildMultiBandRasterSource(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: [
      new Uint16Array([0, 1, 2, 3]),
      new Uint16Array([4, 5, 6, 7]),
      new Uint16Array([8, 9, 10, 11]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
    sourceInterleave: "bil",
  };
  return { kind: "raster", raster };
}

function buildRgbCompositeRasterSnapshot(): SaveableProjectSnapshot {
  const base = buildMultiBandRasterSnapshot();
  const viewport = base.viewports[0]!;
  const source = viewport.source as Extract<ViewportImageSource, { kind: "raster" }>;
  return {
    ...base,
    viewports: [
      {
        ...viewport,
        fileName: "photo.png",
        source: { kind: "raster", raster: { ...source.raster, colorInterpretation: "rgb" } },
      },
    ],
  };
}
