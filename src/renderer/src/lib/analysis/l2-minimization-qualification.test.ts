import { describe, expect, it } from "vitest";

import { addCategoryToLayer, createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { EMPTY_MASK_PANEL_STATE, type MaskPanelState } from "@/lib/masks/mask-panel";

import {
  L2_NEEDS_A_MASK_LAYER,
  L2_NEEDS_A_SELECTED_STACK,
  L2_NEEDS_TWO_PAINTED_CATEGORIES,
  describeL2QualificationProblemOrNull,
  doesMaskLayerQualifyForL2,
  listMaskLayersQualifyingForL2,
} from "./l2-minimization-qualification";

function buildLayerPaintedWith(id: string, painted: ReadonlyArray<number>): MaskLayer {
  const layer = addCategoryToLayer(createMaskLayer(id, `Layer ${id}`, 2, 2));
  return { ...layer, values: Uint8Array.from(painted) };
}

function buildPanelOfLayers(layers: ReadonlyArray<MaskLayer>): MaskPanelState {
  return { layers, selectedLayerId: layers[0]?.id ?? null, isOverlayVisible: true };
}

describe("doesMaskLayerQualifyForL2", () => {
  it("accepts a layer with two painted categories", () => {
    expect(doesMaskLayerQualifyForL2(buildLayerPaintedWith("mask-1", [1, 1, 2, 0]))).toBe(true);
  });

  it("refuses a layer where only one category was painted", () => {
    expect(doesMaskLayerQualifyForL2(buildLayerPaintedWith("mask-1", [1, 1, 0, 0]))).toBe(false);
  });

  it("refuses an untouched layer even though it declares three categories", () => {
    expect(doesMaskLayerQualifyForL2(buildLayerPaintedWith("mask-1", [0, 0, 0, 0]))).toBe(false);
  });
});

describe("listMaskLayersQualifyingForL2", () => {
  it("keeps only the layers L2 can fit against, in panel order", () => {
    const panel = buildPanelOfLayers([
      buildLayerPaintedWith("mask-1", [1, 0, 0, 0]),
      buildLayerPaintedWith("mask-2", [1, 2, 0, 0]),
      buildLayerPaintedWith("mask-3", [3, 2, 1, 0]),
    ]);
    expect(listMaskLayersQualifyingForL2(panel).map((layer) => layer.id)).toEqual([
      "mask-2",
      "mask-3",
    ]);
  });
});

describe("describeL2QualificationProblemOrNull", () => {
  it("asks for a stack when no panel is selected", () => {
    expect(describeL2QualificationProblemOrNull(null)).toBe(L2_NEEDS_A_SELECTED_STACK);
  });

  it("asks for a mask layer when the stack has none", () => {
    expect(describeL2QualificationProblemOrNull(EMPTY_MASK_PANEL_STATE)).toBe(
      L2_NEEDS_A_MASK_LAYER,
    );
  });

  it("asks for two painted categories when no layer qualifies", () => {
    const panel = buildPanelOfLayers([buildLayerPaintedWith("mask-1", [1, 1, 0, 0])]);
    expect(describeL2QualificationProblemOrNull(panel)).toBe(L2_NEEDS_TWO_PAINTED_CATEGORIES);
  });

  it("reports no problem once one layer qualifies", () => {
    const panel = buildPanelOfLayers([
      buildLayerPaintedWith("mask-1", [1, 1, 0, 0]),
      buildLayerPaintedWith("mask-2", [1, 2, 0, 0]),
    ]);
    expect(describeL2QualificationProblemOrNull(panel)).toBeNull();
  });

  it("keeps every explanation inside the locked vocabulary", () => {
    const explanations = [
      L2_NEEDS_A_SELECTED_STACK,
      L2_NEEDS_A_MASK_LAYER,
      L2_NEEDS_TWO_PAINTED_CATEGORIES,
    ];
    for (const explanation of explanations) expect(explanation).not.toMatch(/viewport/i);
  });
});
