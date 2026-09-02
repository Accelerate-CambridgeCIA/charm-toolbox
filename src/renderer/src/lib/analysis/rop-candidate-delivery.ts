import type { ViewportCellContent } from "@/components/viewport-grid";
import {
  findOrOpenFreshResultPanelIndexOrNull,
  reportApplyExceedsMemoryBudget,
  runDuplicateAndApplyAtTargetIndex,
  type ApplyActionFlowBindings,
} from "@/lib/actions/apply-action-flow";
import {
  buildRopCandidateDeliveryAction,
  buildRopFrozenStackDeliveryAction,
  type RopCandidateDeliveryAction,
  type RopKeepRequest,
} from "@/lib/actions/rop-keep-action";
import { NO_PARAMETER_VALUES } from "@/lib/actions/parameter-schema";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import type { RasterImage } from "@/lib/image/raster-image";
import { notifyError } from "@/lib/notifications/notify";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { canPlaceKeptProjectionInAFreePanel } from "./rop-keep-flow";

// CT-316: every "New projection" press delivers its candidate as a REAL
// one-band stack in a candidate panel next to the source. The first press opens
// that panel (lowest free panel, else the next larger layout); later presses
// REPLACE its content in place, so the panel count never grows with presses.
// The aside remembers the live candidate panel by RASTER IDENTITY: a panel the
// user closed, replaced, or changed with an in-place apply no longer holds the
// delivered raster and is never overwritten.

export const ROP_PRESS_NEEDS_A_FREE_PANEL_MESSAGE =
  "Every panel is in use. Close a panel before projecting.";

// CT-317: a press delivers a REPLACEABLE candidate ("Projection ready"); a
// search winner arrives already frozen ("Projection kept"). Only the toast
// differs - the stack, its History entry, and the panel search are identical.
export type RopDeliveryTone = "candidate" | "frozen";

export interface RopLiveCandidatePanel {
  readonly viewportIndex: number;
  readonly raster: RasterImage;
}

interface PanelContentHoldingRaster {
  readonly source: ViewportImageSource;
}

export function isLiveCandidatePanelIntact(
  live: RopLiveCandidatePanel | null,
  imagesByIndex: ReadonlyMap<number, PanelContentHoldingRaster>,
): boolean {
  if (live === null) return false;
  const source = imagesByIndex.get(live.viewportIndex)?.source;
  return source?.kind === "raster" && source.raster === live.raster;
}

// The index the next press replaces, or null when the press must open a fresh
// candidate panel.
export function resolveRopCandidateReplaceIndexOrNull(
  live: RopLiveCandidatePanel | null,
  imagesByIndex: ReadonlyMap<number, PanelContentHoldingRaster>,
): number | null {
  if (live === null || !isLiveCandidatePanelIntact(live, imagesByIndex)) return null;
  return live.viewportIndex;
}

export function canOpenFreshRopCandidatePanel(bindings: ApplyActionFlowBindings): boolean {
  return canPlaceKeptProjectionInAFreePanel(bindings);
}

// CT-330: a run (press or search) has somewhere to deliver its winner exactly
// when it can either replace the live candidate panel or open a fresh one.
// Shared by both paths so a refusal can never be checked differently.
export function canRopRunDeliverSomewhere(
  replaceAtIndex: number | null,
  canOpenFreshCandidatePanel: boolean,
): boolean {
  return replaceAtIndex !== null || canOpenFreshCandidatePanel;
}

// What the aside needs from App to deliver a press: all three read the LATEST
// panel map, so the aside must call them at press and delivery time rather
// than caching their answers.
export interface RopCandidateDeliveryPort {
  readonly canOpenFreshCandidatePanel: () => boolean;
  readonly resolveReplaceIndexOrNull: (live: RopLiveCandidatePanel | null) => number | null;
  readonly deliverCandidate: (
    request: RopKeepRequest,
    replaceAtIndex: number | null,
    tone?: RopDeliveryTone,
  ) => Promise<RopLiveCandidatePanel | null>;
}

export function buildRopCandidateDeliveryPort(
  sourceIndex: number | null,
  bindings: ApplyActionFlowBindings,
): RopCandidateDeliveryPort {
  return {
    canOpenFreshCandidatePanel: () => canOpenFreshRopCandidatePanel(bindings),
    resolveReplaceIndexOrNull: (live) =>
      resolveRopCandidateReplaceIndexOrNull(live, bindings.imagesByIndex),
    deliverCandidate: (request, replaceAtIndex, tone) =>
      sourceIndex === null
        ? Promise.resolve(null)
        : deliverRopCandidateToPanel(request, sourceIndex, replaceAtIndex, bindings, tone),
  };
}

// Resolves with the delivered panel (its index and the exact raster placed) so
// the aside can track it, or null when nothing was placed (refused, failed, or
// stopped; each of those already toasted).
export async function deliverRopCandidateToPanel(
  request: RopKeepRequest,
  sourceIndex: number,
  replaceAtIndex: number | null,
  bindings: ApplyActionFlowBindings,
  tone: RopDeliveryTone = "candidate",
): Promise<RopLiveCandidatePanel | null> {
  const sourceContent = bindings.imagesByIndex.get(sourceIndex);
  if (!sourceContent) return null;
  const delivery = buildRopStackDeliveryForTone(request, tone);
  if (reportApplyExceedsMemoryBudget(delivery.action, sourceContent.source, NO_PARAMETER_VALUES, sourceIndex, bindings)) {
    return null;
  }
  const targetIndex = replaceAtIndex ?? findOrOpenFreshResultPanelIndexOrNull(bindings);
  if (targetIndex === null) {
    notifyError(ROP_PRESS_NEEDS_A_FREE_PANEL_MESSAGE);
    return null;
  }
  const succeeded = await runCandidateDeliveryReportingSuccess(delivery.action, sourceContent, sourceIndex, targetIndex, bindings);
  return succeeded ? { viewportIndex: targetIndex, raster: delivery.raster } : null;
}

// The duplicate-apply flow reports its ending through the optional outcome
// binding; wrapping it (and forwarding to any existing listener) is how the
// delivery learns whether the stack actually landed.
async function runCandidateDeliveryReportingSuccess(
  action: RegisteredViewportAction,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): Promise<boolean> {
  let succeeded = false;
  const observing: ApplyActionFlowBindings = {
    ...bindings,
    reportApplyOutcome: (outcome) => {
      succeeded = outcome.succeeded;
      bindings.reportApplyOutcome?.(outcome);
    },
  };
  await runDuplicateAndApplyAtTargetIndex(action, NO_PARAMETER_VALUES, sourceContent, sourceIndex, targetIndex, observing, {
    selectResultPanel: false,
  });
  return succeeded;
}

function buildRopStackDeliveryForTone(
  request: RopKeepRequest,
  tone: RopDeliveryTone,
): RopCandidateDeliveryAction {
  if (tone === "frozen") return buildRopFrozenStackDeliveryAction(request);
  return buildRopCandidateDeliveryAction(request);
}
