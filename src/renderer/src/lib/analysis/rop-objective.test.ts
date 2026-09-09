import { describe, expect, it } from "vitest";

import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";

import {
  deriveCnrCategoryDefaultsOrNull,
  describeRopObjectiveForHistory,
  findQualifyingRopMaskLayerOrNull,
  isRopObjectiveKindAvailable,
} from "./rop-objective";

function layerWithValues(id: string, values: number[]): MaskLayer {
  const layer = createMaskLayer(id, `Layer ${id}`, values.length, 1);
  return { ...layer, values: Uint8Array.from(values) };
}

function panelOf(layers: MaskLayer[], selectedLayerId: string | null = null): MaskPanelState {
  return { layers, selectedLayerId, isOverlayVisible: true };
}

const EMPTY_PANEL = panelOf([]);
const QUALIFYING_PANEL = panelOf([layerWithValues("a", [1, 2])]);

describe("isRopObjectiveKindAvailable", () => {
  it("always offers None and Custom", () => {
    expect(isRopObjectiveKindAvailable("none", EMPTY_PANEL)).toBe(true);
    expect(isRopObjectiveKindAvailable("custom", EMPTY_PANEL)).toBe(true);
  });

  it("gates NPC and CNR on a layer with two painted categories", () => {
    expect(isRopObjectiveKindAvailable("npc", EMPTY_PANEL)).toBe(false);
    expect(isRopObjectiveKindAvailable("cnr", EMPTY_PANEL)).toBe(false);
    const onePainted = panelOf([layerWithValues("a", [1, 1])]);
    expect(isRopObjectiveKindAvailable("npc", onePainted)).toBe(false);
    expect(isRopObjectiveKindAvailable("cnr", onePainted)).toBe(false);
    expect(isRopObjectiveKindAvailable("npc", QUALIFYING_PANEL)).toBe(true);
    expect(isRopObjectiveKindAvailable("cnr", QUALIFYING_PANEL)).toBe(true);
  });
});

describe("findQualifyingRopMaskLayerOrNull", () => {
  it("prefers the selected layer when it qualifies", () => {
    const first = layerWithValues("a", [1, 2]);
    const selected = layerWithValues("b", [1, 2]);
    expect(findQualifyingRopMaskLayerOrNull(panelOf([first, selected], "b"))).toBe(selected);
  });

  it("falls back to the first qualifying layer when the selected one does not qualify", () => {
    const unqualified = layerWithValues("a", [1, 1]);
    const qualifying = layerWithValues("b", [1, 2]);
    expect(findQualifyingRopMaskLayerOrNull(panelOf([unqualified, qualifying], "a"))).toBe(
      qualifying,
    );
  });

  it("returns null when no layer qualifies", () => {
    expect(findQualifyingRopMaskLayerOrNull(EMPTY_PANEL)).toBeNull();
  });
});

describe("deriveCnrCategoryDefaultsOrNull", () => {
  it("defaults to categories 1 and 2 when both are painted", () => {
    expect(deriveCnrCategoryDefaultsOrNull(layerWithValues("a", [1, 2, 1, 2]))).toEqual({
      textCategoryValue: 1,
      backgroundCategoryValue: 2,
    });
  });

  it("falls back to the first non-empty categories when 1 or 2 is empty", () => {
    const layer = { ...layerWithValues("a", [2, 3]), categories: threeCategories() };
    expect(deriveCnrCategoryDefaultsOrNull(layer)).toEqual({
      textCategoryValue: 2,
      backgroundCategoryValue: 3,
    });
  });

  it("returns null without two painted categories or for a null layer", () => {
    expect(deriveCnrCategoryDefaultsOrNull(layerWithValues("a", [1, 1]))).toBeNull();
    expect(deriveCnrCategoryDefaultsOrNull(null)).toBeNull();
  });
});

function threeCategories() {
  return [
    { id: "c1", name: "One", color: "#ef4444" },
    { id: "c2", name: "Two", color: "#3b82f6" },
    { id: "c3", name: "Three", color: "#22c55e" },
  ];
}

describe("describeRopObjectiveForHistory", () => {
  it("names the built-in objectives and the custom script's file name", () => {
    expect(describeRopObjectiveForHistory("npc", null)).toBe("NPC");
    expect(describeRopObjectiveForHistory("cnr", null)).toBe("CNR");
    expect(
      describeRopObjectiveForHistory("custom", { filePath: "C:/o.py", fileName: "o.py", source: "" }),
    ).toBe("o.py");
    expect(describeRopObjectiveForHistory("none", null)).toBeNull();
  });
});
