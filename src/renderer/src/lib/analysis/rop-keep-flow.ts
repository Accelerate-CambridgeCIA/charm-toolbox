import {
  applyActionToDuplicateOfSource,
  type ApplyActionFlowBindings,
} from "@/lib/actions/apply-action-flow";
import {
  buildRopDeliveryParameterValues,
  buildRopKeepAction,
  type RopKeepRequest,
} from "@/lib/actions/rop-keep-action";
import { findLowestIndexEmptyViewport } from "@/lib/image/find-empty-viewport";
import { getNextLargerGridLayout } from "@/lib/grid/grid-layout";
import { notifyError } from "@/lib/notifications/notify";

// CT-309: Keep and Keep best commit a candidate as a new stack into the lowest
// free panel through the standard duplicate-apply flow. Unlike a menu
// operation, a full grid REFUSES the press outright (locked vocabulary) instead
// of opening the replace-target picker: keeping a projection must never
// overwrite a stack the user did not choose to lose.

export const ROP_KEEP_NEEDS_A_FREE_PANEL_MESSAGE =
  "Every panel is in use. Close a panel before keeping a projection.";

export function keepRopCandidateAsNewStack(
  request: RopKeepRequest,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  if (!canPlaceKeptProjectionInAFreePanel(bindings)) {
    notifyError(ROP_KEEP_NEEDS_A_FREE_PANEL_MESSAGE);
    return;
  }
  applyActionToDuplicateOfSource(
    buildRopKeepAction(request),
    buildRopDeliveryParameterValues(request),
    sourceIndex,
    bindings,
  );
}

// Mirrors the duplicate-apply flow's own search (lowest free panel respecting
// in-flight reservations, then a grid expansion), so the refusal fires exactly
// when that flow would have fallen through to the replace-target picker.
export function canPlaceKeptProjectionInAFreePanel(bindings: ApplyActionFlowBindings): boolean {
  const empty = findLowestIndexEmptyViewport(
    bindings.imagesByIndex,
    bindings.cellCount,
    bindings.inFlightApplyRuns.listReservedResultTargetIndexes(),
  );
  if (empty !== null) return true;
  return getNextLargerGridLayout(bindings.gridLayout) !== null;
}
