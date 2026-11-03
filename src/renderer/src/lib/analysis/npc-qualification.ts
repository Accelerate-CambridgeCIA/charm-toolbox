import { UNLABELED_MASK_VALUE, type MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";

// CT-308: the NPC score measures how separable a stack's labeled regions are,
// so it needs a mask layer whose categories actually carry painted pixels: a
// single class has nothing to be contrasted against, and an empty class makes
// the score undefined (npc.py asserts on both). These predicates decide whether
// the NPC panel's controls are usable, and the description says what is missing
// when they are not.

export const MIN_NPC_NON_EMPTY_CATEGORY_COUNT = 2;

export const NPC_NEEDS_A_SELECTED_STACK =
  "Select a panel with a loaded stack to compute a Potential Contrast score.";
export const NPC_NEEDS_A_MASK_LAYER =
  "This stack has no mask layers. Add one with the Masks tool and paint at least two categories.";
export const NPC_NEEDS_TWO_PAINTED_CATEGORIES =
  "Potential Contrast needs a mask layer with at least two categories that have painted pixels.";

export function listNonEmptyCategoryValuesInMaskLayer(
  layer: MaskLayer,
): ReadonlyArray<number> {
  const painted = collectPaintedCategoryValues(layer.values);
  return layer.categories
    .map((_category, position) => position + 1)
    .filter((categoryValue) => painted.has(categoryValue));
}

function collectPaintedCategoryValues(values: Uint8Array): ReadonlySet<number> {
  const painted = new Set<number>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? UNLABELED_MASK_VALUE;
    if (value !== UNLABELED_MASK_VALUE) painted.add(value);
  }
  return painted;
}

export function doesMaskLayerQualifyForNpc(layer: MaskLayer): boolean {
  return (
    listNonEmptyCategoryValuesInMaskLayer(layer).length >= MIN_NPC_NON_EMPTY_CATEGORY_COUNT
  );
}

export function listMaskLayersQualifyingForNpc(
  panel: MaskPanelState,
): ReadonlyArray<MaskLayer> {
  return panel.layers.filter(doesMaskLayerQualifyForNpc);
}

// null means the panel is ready to compute; a string is the one thing the user
// has to do first, in the locked in-app vocabulary (stack, panel, mask layer,
// category).
export function describeNpcQualificationProblemOrNull(
  panel: MaskPanelState | null,
): string | null {
  if (panel === null) return NPC_NEEDS_A_SELECTED_STACK;
  if (panel.layers.length === 0) return NPC_NEEDS_A_MASK_LAYER;
  if (listMaskLayersQualifyingForNpc(panel).length === 0) {
    return NPC_NEEDS_TWO_PAINTED_CATEGORIES;
  }
  return null;
}
