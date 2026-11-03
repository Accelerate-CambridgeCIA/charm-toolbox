import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";

import {
  listMaskLayersQualifyingForNpc,
  listNonEmptyCategoryValuesInMaskLayer,
} from "./npc-qualification";

// CT-309: which scoring objectives the ROP panel can offer for the active
// stack. ROP itself needs no masks (a projection is just math over the cube);
// only the mask-driven objectives gate on a qualifying layer: NPC and CNR both
// need a layer with at least two categories that have painted pixels (CNR
// scores a text category against a background category, so two non-empty
// categories is exactly what it needs too).

export type RopObjectiveKind = "none" | "npc" | "cnr" | "custom";

export interface RopCustomObjectiveScript {
  readonly filePath: string;
  readonly fileName: string;
  // CT-310: the script's own source, read at import. A press scores the
  // candidate by running the FILE, but a search has to evaluate the objective
  // per candidate INSIDE its single Python run, so the source travels as a run
  // parameter. Keeping both on one object is what stops the two paths from
  // scoring with different code.
  readonly source: string;
}

export const ROP_OBJECTIVES_NEED_TWO_PAINTED_CATEGORIES =
  "Potential Contrast and CNR need a mask layer with at least two categories that have painted pixels.";

// The scored objectives read the layer the Masks tool has selected when it
// qualifies, otherwise the first qualifying layer, mirroring the NPC panel's
// default so the two tools agree on which labels they score.
export function findQualifyingRopMaskLayerOrNull(panel: MaskPanelState): MaskLayer | null {
  const qualifying = listMaskLayersQualifyingForNpc(panel);
  const selected = qualifying.find((layer) => layer.id === panel.selectedLayerId);
  return selected ?? qualifying[0] ?? null;
}

export function isRopObjectiveKindAvailable(
  kind: RopObjectiveKind,
  panel: MaskPanelState,
): boolean {
  if (kind === "npc" || kind === "cnr") {
    return findQualifyingRopMaskLayerOrNull(panel) !== null;
  }
  return true;
}

// CNR defaults to categories 1 and 2 (the locked decision); when either is
// empty the defaults fall back to the first non-empty categories in index
// order, so the pickers never start on a category CNR would reject.
export interface CnrCategoryDefaults {
  readonly textCategoryValue: number;
  readonly backgroundCategoryValue: number;
}

export function deriveCnrCategoryDefaultsOrNull(
  layer: MaskLayer | null,
): CnrCategoryDefaults | null {
  if (layer === null) return null;
  const nonEmpty = listNonEmptyCategoryValuesInMaskLayer(layer);
  const firstNonEmpty = nonEmpty[0];
  if (nonEmpty.length < 2 || firstNonEmpty === undefined) return null;
  const text = nonEmpty.includes(1) ? 1 : firstNonEmpty;
  const background = pickBackgroundDefaultDistinctFromText(nonEmpty, text);
  return { textCategoryValue: text, backgroundCategoryValue: background };
}

function pickBackgroundDefaultDistinctFromText(
  nonEmptyCategoryValues: ReadonlyArray<number>,
  textCategoryValue: number,
): number {
  if (nonEmptyCategoryValues.includes(2) && textCategoryValue !== 2) return 2;
  return nonEmptyCategoryValues.find((value) => value !== textCategoryValue) ?? textCategoryValue;
}

// The kept-stack History entry names the objective that produced the score.
export function describeRopObjectiveForHistory(
  kind: RopObjectiveKind,
  customScript: RopCustomObjectiveScript | null,
): string | null {
  if (kind === "npc") return "Potential Contrast";
  if (kind === "cnr") return "CNR";
  if (kind === "custom") return customScript?.fileName ?? "Custom script";
  return null;
}
