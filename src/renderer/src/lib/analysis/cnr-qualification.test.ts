import { describe, expect, it } from "vitest";

import { addCategoryToLayer, createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { EMPTY_MASK_PANEL_STATE, type MaskPanelState } from "@/lib/masks/mask-panel";

import {
  CNR_NEEDS_A_MASK_LAYER,
  CNR_NEEDS_A_SELECTED_STACK,
  CNR_NEEDS_TWO_PAINTED_CATEGORIES,
  describeCnrQualificationProblemOrNull,
  doesMaskLayerQualifyForCnr,
  listMaskLayersQualifyingForCnr,
} from "./cnr-qualification";

function buildLayerPaintedWith(id: string, painted: ReadonlyArray<number>): MaskLayer {
  const layer = addCategoryToLayer(createMaskLayer(id, `Layer ${id}`, 2, 2));
  return { ...layer, values: Uint8Array.from(painted) };
}

function buildPanelOfLayers(layers: ReadonlyArray<MaskLayer>): MaskPanelState {
  return { layers, selectedLayerId: layers[0]?.id ?? null, isOverlayVisible: true };
}

describe("doesMaskLayerQualifyForCnr", () => {
  it("accepts a layer with two painted categories", () => {
    expect(doesMaskLayerQualifyForCnr(buildLayerPaintedWith("mask-1", [1, 1, 2, 0]))).toBe(true);
  });

  it("refuses a layer where only one category was painted", () => {
    expect(doesMaskLayerQualifyForCnr(buildLayerPaintedWith("mask-1", [1, 1, 0, 0]))).toBe(false);
  });
});

describe("listMaskLayersQualifyingForCnr", () => {
  it("keeps only the layers CNR can score, in panel order", () => {
    const panel = buildPanelOfLayers([
      buildLayerPaintedWith("mask-1", [1, 0, 0, 0]),
      buildLayerPaintedWith("mask-2", [1, 2, 0, 0]),
    ]);
    expect(listMaskLayersQualifyingForCnr(panel).map((layer) => layer.id)).toEqual(["mask-2"]);
  });
});

describe("describeCnrQualificationProblemOrNull", () => {
  it("asks for a stack when no panel is selected", () => {
    expect(describeCnrQualificationProblemOrNull(null)).toBe(CNR_NEEDS_A_SELECTED_STACK);
  });

  it("asks for a mask layer when the stack has none", () => {
    expect(describeCnrQualificationProblemOrNull(EMPTY_MASK_PANEL_STATE)).toBe(
      CNR_NEEDS_A_MASK_LAYER,
    );
  });

  it("asks for two painted categories when no layer qualifies", () => {
    const panel = buildPanelOfLayers([buildLayerPaintedWith("mask-1", [1, 1, 0, 0])]);
    expect(describeCnrQualificationProblemOrNull(panel)).toBe(CNR_NEEDS_TWO_PAINTED_CATEGORIES);
  });

  it("reports no problem once a layer has two painted categories", () => {
    const panel = buildPanelOfLayers([buildLayerPaintedWith("mask-1", [1, 2, 0, 0])]);
    expect(describeCnrQualificationProblemOrNull(panel)).toBeNull();
  });
});

// The locked in-app vocabulary says "panel" and "stack"; "viewport" is
// implementation language and must never reach a user-facing sentence.
describe("CNR qualification sentences", () => {
  it("names CNR and never says viewport", () => {
    const sentences = [
      CNR_NEEDS_A_SELECTED_STACK,
      CNR_NEEDS_A_MASK_LAYER,
      CNR_NEEDS_TWO_PAINTED_CATEGORIES,
    ];
    for (const sentence of sentences) {
      expect(sentence.toLowerCase()).not.toContain("viewport");
    }
    expect(CNR_NEEDS_A_SELECTED_STACK).toContain("CNR");
    expect(CNR_NEEDS_TWO_PAINTED_CATEGORIES).toContain("CNR");
  });
});
