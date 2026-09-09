import { describe, expect, it } from "vitest";

import { addCategoryToLayer, createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { EMPTY_MASK_PANEL_STATE, type MaskPanelState } from "@/lib/masks/mask-panel";

import {
  NPC_NEEDS_A_MASK_LAYER,
  NPC_NEEDS_A_SELECTED_STACK,
  NPC_NEEDS_TWO_PAINTED_CATEGORIES,
  describeNpcQualificationProblemOrNull,
  doesMaskLayerQualifyForNpc,
  listMaskLayersQualifyingForNpc,
  listNonEmptyCategoryValuesInMaskLayer,
} from "./npc-qualification";

function buildLayerPaintedWith(id: string, painted: ReadonlyArray<number>): MaskLayer {
  const layer = addCategoryToLayer(createMaskLayer(id, `Layer ${id}`, 2, 2));
  return { ...layer, values: Uint8Array.from(painted) };
}

function buildPanelOfLayers(layers: ReadonlyArray<MaskLayer>): MaskPanelState {
  return { layers, selectedLayerId: layers[0]?.id ?? null, isOverlayVisible: true };
}

describe("listNonEmptyCategoryValuesInMaskLayer", () => {
  it("reports only the categories that actually have painted pixels", () => {
    const layer = buildLayerPaintedWith("mask-1", [1, 0, 3, 0]);
    expect(listNonEmptyCategoryValuesInMaskLayer(layer)).toEqual([1, 3]);
  });

  it("reports nothing for a layer where every pixel is unlabeled", () => {
    expect(listNonEmptyCategoryValuesInMaskLayer(buildLayerPaintedWith("mask-1", [0, 0, 0, 0])))
      .toEqual([]);
  });

  it("ignores a stored value with no category at that position", () => {
    const layer = buildLayerPaintedWith("mask-1", [1, 2, 5, 0]);
    expect(listNonEmptyCategoryValuesInMaskLayer(layer)).toEqual([1, 2]);
  });
});

describe("doesMaskLayerQualifyForNpc", () => {
  it("accepts a layer with two painted categories", () => {
    expect(doesMaskLayerQualifyForNpc(buildLayerPaintedWith("mask-1", [1, 1, 2, 0]))).toBe(true);
  });

  it("refuses a layer where only one category was painted", () => {
    expect(doesMaskLayerQualifyForNpc(buildLayerPaintedWith("mask-1", [1, 1, 0, 0]))).toBe(false);
  });

  it("refuses an untouched layer even though it declares three categories", () => {
    expect(doesMaskLayerQualifyForNpc(buildLayerPaintedWith("mask-1", [0, 0, 0, 0]))).toBe(false);
  });
});

describe("listMaskLayersQualifyingForNpc", () => {
  it("keeps only the layers NPC can score, in panel order", () => {
    const panel = buildPanelOfLayers([
      buildLayerPaintedWith("mask-1", [1, 0, 0, 0]),
      buildLayerPaintedWith("mask-2", [1, 2, 0, 0]),
      buildLayerPaintedWith("mask-3", [3, 2, 1, 0]),
    ]);
    expect(listMaskLayersQualifyingForNpc(panel).map((layer) => layer.id)).toEqual([
      "mask-2",
      "mask-3",
    ]);
  });
});

describe("describeNpcQualificationProblemOrNull", () => {
  it("asks for a stack when no panel is selected", () => {
    expect(describeNpcQualificationProblemOrNull(null)).toBe(NPC_NEEDS_A_SELECTED_STACK);
  });

  it("asks for a mask layer when the stack has none", () => {
    expect(describeNpcQualificationProblemOrNull(EMPTY_MASK_PANEL_STATE)).toBe(
      NPC_NEEDS_A_MASK_LAYER,
    );
  });

  it("asks for two painted categories when no layer qualifies", () => {
    const panel = buildPanelOfLayers([buildLayerPaintedWith("mask-1", [1, 1, 0, 0])]);
    expect(describeNpcQualificationProblemOrNull(panel)).toBe(NPC_NEEDS_TWO_PAINTED_CATEGORIES);
  });

  it("reports no problem once one layer qualifies", () => {
    const panel = buildPanelOfLayers([
      buildLayerPaintedWith("mask-1", [1, 1, 0, 0]),
      buildLayerPaintedWith("mask-2", [1, 2, 0, 0]),
    ]);
    expect(describeNpcQualificationProblemOrNull(panel)).toBeNull();
  });

  it("keeps every explanation inside the locked vocabulary", () => {
    const explanations = [
      NPC_NEEDS_A_SELECTED_STACK,
      NPC_NEEDS_A_MASK_LAYER,
      NPC_NEEDS_TWO_PAINTED_CATEGORIES,
    ];
    for (const explanation of explanations) expect(explanation).not.toMatch(/viewport/i);
  });
});
