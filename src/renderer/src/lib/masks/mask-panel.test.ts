import { describe, expect, it } from "vitest";

import {
  addImportedMaskLayerToPanel,
  addNewMaskLayerToPanel,
  deleteMaskLayerFromPanel,
  EMPTY_MASK_PANEL_STATE,
  findSelectedMaskLayerOrNull,
  hideMaskOverlay,
  panelHasMaskLayers,
  renameMaskLayerInPanel,
  replaceMaskLayerInPanel,
  replaceSelectedMaskLayerValues,
  selectMaskLayerInPanel,
  showMaskOverlay,
  toggleMaskOverlayVisibility,
  type MaskPanelState,
} from "./mask-panel";
import { setMaskLayerOpacityPercent, type MaskLayerContent } from "./mask-layer";

function buildPanelWithLayers(count: number): MaskPanelState {
  let panel = EMPTY_MASK_PANEL_STATE;
  for (let added = 0; added < count; added += 1) panel = addNewMaskLayerToPanel(panel, 4, 3);
  return panel;
}

describe("mask panel layers", () => {
  it("starts empty", () => {
    expect(panelHasMaskLayers(EMPTY_MASK_PANEL_STATE)).toBe(false);
    expect(findSelectedMaskLayerOrNull(EMPTY_MASK_PANEL_STATE)).toBeNull();
  });

  it("names and selects each new layer, with no cap on the count", () => {
    const panel = buildPanelWithLayers(7);
    expect(panel.layers.map((layer) => layer.name)).toEqual([
      "Mask 1",
      "Mask 2",
      "Mask 3",
      "Mask 4",
      "Mask 5",
      "Mask 6",
      "Mask 7",
    ]);
    expect(findSelectedMaskLayerOrNull(panel)?.name).toBe("Mask 7");
  });

  it("keeps exactly one layer selected", () => {
    const panel = selectMaskLayerInPanel(buildPanelWithLayers(3), "mask-1");
    expect(panel.selectedLayerId).toBe("mask-1");
    expect(selectMaskLayerInPanel(panel, "mask-404")).toBe(panel);
  });

  it("renames one layer and replaces one layer in place", () => {
    const panel = buildPanelWithLayers(2);
    const renamed = renameMaskLayerInPanel(panel, "mask-1", "Sample area");
    const dimmed = replaceMaskLayerInPanel(renamed, "mask-2", (layer) =>
      setMaskLayerOpacityPercent(layer, 20),
    );
    expect(dimmed.layers.map((layer) => layer.name)).toEqual(["Sample area", "Mask 2"]);
    expect(dimmed.layers.map((layer) => layer.opacityPercent)).toEqual([50, 20]);
  });

  it("moves the selection to the layer that took the deleted one's place", () => {
    const panel = selectMaskLayerInPanel(buildPanelWithLayers(3), "mask-2");
    expect(deleteMaskLayerFromPanel(panel, "mask-2").selectedLayerId).toBe("mask-3");
  });

  it("keeps the selection when another layer is deleted", () => {
    const panel = selectMaskLayerInPanel(buildPanelWithLayers(3), "mask-2");
    expect(deleteMaskLayerFromPanel(panel, "mask-1").selectedLayerId).toBe("mask-2");
  });

  it("clears the selection when the last layer is deleted", () => {
    const panel = deleteMaskLayerFromPanel(buildPanelWithLayers(1), "mask-1");
    expect(panel).toEqual(EMPTY_MASK_PANEL_STATE);
  });

  it("never reuses a layer id after a delete", () => {
    const afterDelete = deleteMaskLayerFromPanel(buildPanelWithLayers(2), "mask-1");
    const readded = addNewMaskLayerToPanel(afterDelete, 4, 3);
    expect(readded.layers.map((layer) => layer.id)).toEqual(["mask-2", "mask-3"]);
  });

  it("adds an imported layer with its own name, categories, and values, and selects it", () => {
    const imported: MaskLayerContent = {
      name: "Parchment mask",
      width: 4,
      height: 3,
      values: Uint8Array.from(new Array(12).fill(1)),
      categories: [{ id: "category-1", name: "Parchment", color: "#111111" }],
      opacityPercent: 60,
    };
    const panel = addImportedMaskLayerToPanel(buildPanelWithLayers(2), imported);
    expect(panel.layers.map((layer) => layer.id)).toEqual(["mask-1", "mask-2", "mask-3"]);
    expect(panel.selectedLayerId).toBe("mask-3");
    expect(panel.layers[2]).toEqual({ id: "mask-3", ...imported });
  });

  it("replaces only the selected layer's painted values", () => {
    const panel = selectMaskLayerInPanel(buildPanelWithLayers(2), "mask-2");
    const painted = Uint8Array.from(new Array(12).fill(2));
    const next = replaceSelectedMaskLayerValues(panel, painted);
    expect(next.layers[1]?.values).toBe(painted);
    expect(Array.from(next.layers[0]?.values ?? [])).toEqual(new Array(12).fill(0));
  });

  it("leaves the panel untouched when no layer is selected", () => {
    expect(replaceSelectedMaskLayerValues(EMPTY_MASK_PANEL_STATE, new Uint8Array(4))).toBe(
      EMPTY_MASK_PANEL_STATE,
    );
  });
});

// CT-342: the overlay switch is the panel's own state, so it survives every
// layer edit and is the single thing the rendering gate reads.
describe("mask overlay visibility", () => {
  it("starts visible on an empty panel", () => {
    expect(EMPTY_MASK_PANEL_STATE.isOverlayVisible).toBe(true);
  });

  it("toggles off and back on without touching the layers", () => {
    const panel = buildPanelWithLayers(2);
    const hidden = toggleMaskOverlayVisibility(panel);
    const shownAgain = toggleMaskOverlayVisibility(hidden);
    expect([hidden.isOverlayVisible, shownAgain.isOverlayVisible]).toEqual([false, true]);
    expect(hidden.layers).toBe(panel.layers);
    expect(hidden.selectedLayerId).toBe(panel.selectedLayerId);
  });

  it("shows the overlay whatever it was showing before", () => {
    expect(showMaskOverlay(hideMaskOverlay(EMPTY_MASK_PANEL_STATE)).isOverlayVisible).toBe(true);
    expect(showMaskOverlay(EMPTY_MASK_PANEL_STATE).isOverlayVisible).toBe(true);
  });

  it("keeps a hidden overlay hidden across adding and deleting layers", () => {
    const hidden = hideMaskOverlay(buildPanelWithLayers(2));
    const added = addNewMaskLayerToPanel(hidden, 4, 3);
    const deleted = deleteMaskLayerFromPanel(added, "mask-1");
    expect([added.isOverlayVisible, deleted.isOverlayVisible]).toEqual([false, false]);
  });
});
