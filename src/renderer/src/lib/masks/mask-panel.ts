import { buildNextPrefixedIdentifier, findNextFreeNumberForPrefix } from "@/lib/masks/mask-identifiers";
import {
  createMaskLayer,
  type MaskLayer,
  type MaskLayerContent,
} from "@/lib/masks/mask-layer";

// CT-302: a panel holds any number of mask layers (no fixed cap; the renderer's
// memory budget governs) and exactly one of them is selected at a time. Only
// the selected layer renders as an overlay.
// CT-342: whether that overlay is drawn is the panel's own switch, on by
// default. It is the ONLY thing that gates the overlay - neither the panel's
// selection nor the Masks tool takes part any more.

export interface MaskPanelState {
  readonly layers: ReadonlyArray<MaskLayer>;
  readonly selectedLayerId: string | null;
  readonly isOverlayVisible: boolean;
}

export const EMPTY_MASK_PANEL_STATE: MaskPanelState = Object.freeze({
  layers: Object.freeze([]),
  selectedLayerId: null,
  isOverlayVisible: true,
});

export function setMaskOverlayVisibility(
  panel: MaskPanelState,
  isOverlayVisible: boolean,
): MaskPanelState {
  return { ...panel, isOverlayVisible };
}

export function toggleMaskOverlayVisibility(panel: MaskPanelState): MaskPanelState {
  return setMaskOverlayVisibility(panel, !panel.isOverlayVisible);
}

export function showMaskOverlay(panel: MaskPanelState): MaskPanelState {
  return setMaskOverlayVisibility(panel, true);
}

export function hideMaskOverlay(panel: MaskPanelState): MaskPanelState {
  return setMaskOverlayVisibility(panel, false);
}

// CT-344: opening the Masks tool shows the active panel's overlay, so a
// hidden mask never leaves the tool open on a blank canvas. `wasToolActive` is
// the tool's state BEFORE the toggle: only a false -> true transition (the
// tool is about to open) shows it; closing the tool leaves the flag as is.
export function showMaskOverlayWhenOpeningMasksTool(
  panel: MaskPanelState,
  wasToolActive: boolean,
): MaskPanelState {
  return wasToolActive ? panel : showMaskOverlay(panel);
}

const MASK_LAYER_ID_PREFIX = "mask";

export function panelHasMaskLayers(panel: MaskPanelState): boolean {
  return panel.layers.length > 0;
}

export function findSelectedMaskLayerOrNull(panel: MaskPanelState): MaskLayer | null {
  return panel.layers.find((layer) => layer.id === panel.selectedLayerId) ?? null;
}

export function addNewMaskLayerToPanel(
  panel: MaskPanelState,
  width: number,
  height: number,
): MaskPanelState {
  return appendMaskLayerSelectingIt(panel, buildNextMaskLayerForPanel(panel, width, height));
}

// CT-303: an imported mask arrives with its own name, categories, and painted
// values; only its id belongs to the panel.
export function addImportedMaskLayerToPanel(
  panel: MaskPanelState,
  content: MaskLayerContent,
): MaskPanelState {
  const id = buildNextPrefixedIdentifier(
    MASK_LAYER_ID_PREFIX,
    panel.layers.map((layer) => layer.id),
  );
  return appendMaskLayerSelectingIt(panel, { id, ...content });
}

function appendMaskLayerSelectingIt(
  panel: MaskPanelState,
  added: MaskLayer,
): MaskPanelState {
  return { ...panel, layers: [...panel.layers, added], selectedLayerId: added.id };
}

function buildNextMaskLayerForPanel(
  panel: MaskPanelState,
  width: number,
  height: number,
): MaskLayer {
  const existingIds = panel.layers.map((layer) => layer.id);
  const id = buildNextPrefixedIdentifier(MASK_LAYER_ID_PREFIX, existingIds);
  const name = `Mask ${findNextFreeNumberForPrefix(MASK_LAYER_ID_PREFIX, existingIds)}`;
  return createMaskLayer(id, name, width, height);
}

export function selectMaskLayerInPanel(panel: MaskPanelState, layerId: string): MaskPanelState {
  if (!panel.layers.some((layer) => layer.id === layerId)) return panel;
  return { ...panel, selectedLayerId: layerId };
}

export function renameMaskLayerInPanel(
  panel: MaskPanelState,
  layerId: string,
  name: string,
): MaskPanelState {
  return replaceMaskLayerInPanel(panel, layerId, (layer) => ({ ...layer, name }));
}

export function replaceMaskLayerInPanel(
  panel: MaskPanelState,
  layerId: string,
  replace: (layer: MaskLayer) => MaskLayer,
): MaskPanelState {
  const layers = panel.layers.map((layer) => (layer.id === layerId ? replace(layer) : layer));
  return { ...panel, layers };
}

// CT-304: a committed brush stroke replaces the selected layer's painted
// values wholesale (the stroke owns the array it hands over).
export function replaceSelectedMaskLayerValues(
  panel: MaskPanelState,
  values: Uint8Array,
): MaskPanelState {
  if (!panel.selectedLayerId) return panel;
  return replaceMaskLayerInPanel(panel, panel.selectedLayerId, (layer) => ({ ...layer, values }));
}

export function deleteMaskLayerFromPanel(
  panel: MaskPanelState,
  layerId: string,
): MaskPanelState {
  const position = panel.layers.findIndex((layer) => layer.id === layerId);
  if (position < 0) return panel;
  const layers = panel.layers.filter((layer) => layer.id !== layerId);
  return { ...panel, layers, selectedLayerId: pickSelectionAfterDelete(panel, layers, position) };
}

// The selection lands on the layer that took the deleted one's place, or on the
// new last layer when the deleted one was last.
function pickSelectionAfterDelete(
  panel: MaskPanelState,
  layers: ReadonlyArray<MaskLayer>,
  deletedPosition: number,
): string | null {
  if (panel.selectedLayerId !== panel.layers[deletedPosition]?.id) return panel.selectedLayerId;
  const nextPosition = Math.min(deletedPosition, layers.length - 1);
  return layers[nextPosition]?.id ?? null;
}
