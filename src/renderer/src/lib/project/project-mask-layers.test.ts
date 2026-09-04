import { describe, expect, it } from "vitest";

import { EMPTY_MASK_PANEL_STATE, type MaskPanelState } from "@/lib/masks/mask-panel";
import type { MaskLayer } from "@/lib/masks/mask-layer";

import {
  buildMaskPanelStateFromRestoredLayers,
  describeMaskLayerForManifest,
  findSelectedMaskLayerPositionOrNull,
  type RestorableMaskLayer,
} from "./project-mask-layers";
import type { ProjectMaskLayer } from "./project-schema";

describe("describeMaskLayerForManifest", () => {
  it("keeps the layer's name, size, categories, and opacity", () => {
    expect(describeMaskLayerForManifest(buildLayer("mask-1", "Parchment mask", 60))).toEqual({
      name: "Parchment mask",
      width: 2,
      height: 2,
      categories: [
        { name: "Parchment", color: "#ef4444" },
        { name: "Substrate", color: "#3b82f6" },
      ],
      opacityPercent: 60,
    });
  });

  it("leaves the panel-assigned category ids out of the manifest", () => {
    const described = describeMaskLayerForManifest(buildLayer("mask-1", "Mask 1", 50));
    expect(described.categories[0]).not.toHaveProperty("id");
  });
});

describe("findSelectedMaskLayerPositionOrNull", () => {
  it("reports the position of the selected layer", () => {
    expect(findSelectedMaskLayerPositionOrNull(buildPanelSelecting("mask-2"))).toBe(1);
  });

  it("reports null when nothing is selected", () => {
    expect(findSelectedMaskLayerPositionOrNull(EMPTY_MASK_PANEL_STATE)).toBeNull();
  });

  it("reports null when the selected id names no layer", () => {
    expect(findSelectedMaskLayerPositionOrNull(buildPanelSelecting("mask-9"))).toBeNull();
  });
});

describe("buildMaskPanelStateFromRestoredLayers", () => {
  it("restores every layer in order with fresh panel-assigned ids", () => {
    const panel = buildMaskPanelStateFromRestoredLayers(buildTwoRestorableLayers(), 0);
    expect(panel.layers.map((layer) => layer.name)).toEqual(["Mask 1", "Mask 2"]);
    expect(panel.layers.map((layer) => layer.id)).toEqual(["mask-1", "mask-2"]);
  });

  it("restores the painted category indexes and the labelling beside them", () => {
    const panel = buildMaskPanelStateFromRestoredLayers(buildTwoRestorableLayers(), 0);
    expect(Array.from(panel.layers[0]!.values)).toEqual([0, 1, 1, 0]);
    expect(panel.layers[0]!.categories).toEqual([
      { id: "category-1", name: "Parchment", color: "#ef4444" },
    ]);
    expect(panel.layers[0]!.opacityPercent).toBe(60);
  });

  it("selects the layer at the recorded position", () => {
    const panel = buildMaskPanelStateFromRestoredLayers(buildTwoRestorableLayers(), 0);
    expect(panel.selectedLayerId).toBe("mask-1");
  });

  it("leaves the last restored layer selected when no position was recorded", () => {
    const panel = buildMaskPanelStateFromRestoredLayers(buildTwoRestorableLayers(), null);
    expect(panel.selectedLayerId).toBe("mask-2");
  });

  it("restores an empty panel from an entry with no mask layers", () => {
    expect(buildMaskPanelStateFromRestoredLayers([], null)).toEqual(EMPTY_MASK_PANEL_STATE);
  });
});

// CT-306: the pair of conversions is the round trip a saved project performs,
// so the labelling must survive it untouched.
describe("mask layer manifest round trip", () => {
  it("returns the same names, colours, opacity, and selection", () => {
    const original = buildPanelSelecting("mask-2");
    const restored = buildMaskPanelStateFromRestoredLayers(
      original.layers.map(describeAsRestorableLayer),
      findSelectedMaskLayerPositionOrNull(original),
    );
    expect(restored.layers.map(describeMaskLayerForManifest)).toEqual(
      original.layers.map(describeMaskLayerForManifest),
    );
    expect(restored.selectedLayerId).toBe("mask-2");
  });
});

function describeAsRestorableLayer(layer: MaskLayer): RestorableMaskLayer {
  return {
    manifest: {
      ...describeMaskLayerForManifest(layer),
      relativePath: `assets/viewport-0-mask-${layer.id}.png`,
    },
    values: layer.values,
  };
}

function buildTwoRestorableLayers(): ReadonlyArray<RestorableMaskLayer> {
  return [
    {
      manifest: buildManifest("Mask 1", "assets/viewport-0-mask-0.png", 60),
      values: Uint8Array.from([0, 1, 1, 0]),
    },
    {
      manifest: buildManifest("Mask 2", "assets/viewport-0-mask-1.png", 30),
      values: Uint8Array.from([1, 1, 1, 1]),
    },
  ];
}

function buildManifest(
  name: string,
  relativePath: string,
  opacityPercent: number,
): ProjectMaskLayer {
  return {
    name,
    relativePath,
    width: 2,
    height: 2,
    categories: [{ name: "Parchment", color: "#ef4444" }],
    opacityPercent,
  };
}

function buildPanelSelecting(selectedLayerId: string): MaskPanelState {
  return {
    layers: [buildLayer("mask-1", "Mask 1", 60), buildLayer("mask-2", "Mask 2", 30)],
    selectedLayerId,
    isOverlayVisible: true,
  };
}

function buildLayer(id: string, name: string, opacityPercent: number): MaskLayer {
  return {
    id,
    name,
    width: 2,
    height: 2,
    values: Uint8Array.from([0, 1, 2, 0]),
    categories: [
      { id: "category-1", name: "Parchment", color: "#ef4444" },
      { id: "category-2", name: "Substrate", color: "#3b82f6" },
    ],
    opacityPercent,
  };
}
