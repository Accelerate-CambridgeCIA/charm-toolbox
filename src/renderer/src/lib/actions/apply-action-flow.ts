import type { ViewportCellContent } from "@/components/viewport-grid";
import type { PendingDuplicateReplace } from "@/components/viewport-duplicate-replace-target-picker";
import {
  estimateApplyAllocationBytesForAction,
  estimateSourceCloneBytes,
} from "@/lib/actions/estimate-apply-allocation";
import { appendOperationHistoryEntry } from "@/lib/actions/operation-history";
import {
  describeOperationLoadingMessage,
  shouldShowOperationLoadingImmediately,
} from "@/lib/actions/operation-loading-message";
import type { ParameterValuesById } from "@/lib/actions/parameter-schema";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import {
  actionTransformsSource,
  runActionSourceTransform,
  type ViewportActionOutput,
  type ViewportRenderingState,
} from "@/lib/actions/viewport-action";
import { clampSelectedBandIndexToRaster } from "@/lib/actions/clamp-selected-band-index";
import { composeApplySuccessMessage } from "@/lib/actions/apply-success-message";
import { clearOperationRegionAtViewportIndex } from "@/lib/actions/operation-region";
import type {
  InFlightApplyRunReservation,
  InFlightApplyRunStore,
} from "@/lib/actions/in-flight-apply-run-store";
import {
  isOperationStoppedError,
  OperationStoppedError,
  OPERATION_STOPPED_MESSAGE,
} from "@/lib/image/operation-stop";
import { notifyError, notifyPersistentError, notifySuccess } from "@/lib/notifications/notify";
import { toast } from "sonner";
import { RasterMemoryAllocationError } from "@/lib/image/raster-allocation";
import { getImageSourceDimensions, type ViewportImageSource } from "@/lib/webgl/texture";
import {
  MASKS_REMOVED_BY_GEOMETRY_CHANGE_MESSAGE,
  wereMasksDroppedByGeometryChange,
  type StackGeometryComparison,
} from "@/lib/masks/mask-geometry-change";
import { carryMasksAcrossStackGeometryChange } from "@/lib/masks/mask-geometry-transform";
import { EMPTY_MASK_PANEL_STATE } from "@/lib/masks/mask-panel";
import { getNextLargerGridLayout, type GridLayout } from "@/lib/grid/grid-layout";
import { findLowestIndexEmptyViewport } from "@/lib/image/find-empty-viewport";
import {
  placeClonedSourceContentAtIndex,
  type ViewportContentMap,
  type ViewportContentMapUpdater,
} from "@/lib/image/place-cloned-source-content";
import {
  assertRasterAllocationFitsMemoryBudget,
  OPERATION_MEMORY_REFUSAL_MESSAGE,
  sumLiveRasterBytesAcrossSources,
} from "@/lib/image/raster-memory-budget";
import {
  holdSourceBuffersWhileInUse,
  queueOutgoingRasterSourceForBufferRelease,
} from "@/lib/image/raster-buffer-release";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

export interface ApplyActionFlowBindings {
  gridLayout: GridLayout;
  cellCount: number;
  imagesByIndex: ViewportContentMap;
  setGridLayout: (layout: GridLayout) => void;
  setImagesByIndex: (updater: ViewportContentMapUpdater) => void;
  setPendingDuplicate: (pending: PendingDuplicateReplace | null) => void;
  getRenderingState: (index: number) => ViewportRenderingState;
  setRenderingState: (index: number, next: ViewportRenderingState) => void;
  // CT-105: selects the panel that now holds an operation's result so the user's
  // next action targets the result rather than the original source panel.
  selectViewportIndex?: (index: number) => void;
  busyRegistrar: BusyEntryRegistrar;
  // CT-269: shared bookkeeping of in-flight applies. Every apply reserves its
  // result panel here so concurrent applies never share a target, a close of
  // the reserved target cancels the run, and index shifts from unrelated panel
  // closes reach the run before it places its result.
  inFlightApplyRuns: InFlightApplyRunStore;
  // Reports how an apply run ended (the run is asynchronous, so this fires
  // after the click returns). App uses it for actions whose panel stays open
  // until a run SUCCEEDS (keepsPanelOpenUntilApplySucceeds): success closes
  // the panel, failure leaves it open for correction.
  reportApplyOutcome?: (outcome: { succeeded: boolean }) => void;
}

export function applyActionInPlaceAtSourceIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  if (actionTransformsSource(action)) {
    const content = bindings.imagesByIndex.get(sourceIndex);
    if (content && reportApplyExceedsMemoryBudget(action, content.source, parameterValues, sourceIndex, bindings)) return;
    void runApplyActionInPlaceWithBusyIndicator(action, parameterValues, sourceIndex, bindings);
    return;
  }
  applyActionInPlaceWithoutBusyIndicator(action, parameterValues, sourceIndex, bindings);
}

// CT-239: refuse an apply whose new band arrays cannot fit in the renderer's
// ArrayBuffer pool alongside the panels already open, BEFORE a result panel is
// reserved or any allocation starts. An in-place apply is gated identically:
// the transform still materializes the whole output while the source is alive.
// Exported for flows that deliver a result outside applyActionToDuplicateOfSource
// (the CT-316 ROP candidate delivery) so they preflight the same way.
export function reportApplyExceedsMemoryBudget(
  action: RegisteredViewportAction,
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): boolean {
  try {
    const allocationBytes = actionTransformsSource(action)
      ? estimateApplyAllocationBytesForAction(action, source, parameterValues)
      : estimateSourceCloneBytes(source);
    assertRasterAllocationFitsMemoryBudget(
      allocationBytes,
      sumLiveRasterBytesAcrossSources(listSourcesAcrossViewports(bindings.imagesByIndex)),
      OPERATION_MEMORY_REFUSAL_MESSAGE,
    );
    return false;
  } catch (error) {
    reportApplyFailedWithToast(action, sourceIndex, bindings, error);
    return true;
  }
}

// Success and failure both toast AND report the outcome to the optional
// binding, so panel-close decisions stay in one place per outcome.
function reportApplySucceededWithToast(
  action: RegisteredViewportAction,
  bindings: ApplyActionFlowBindings,
  resultOpenedInNewPanel: boolean,
): void {
  notifySuccess(composeApplySuccessMessage(action, resultOpenedInNewPanel));
  bindings.reportApplyOutcome?.({ succeeded: true });
}

// CT-261: a failed apply also clears the source's operation region, so no
// unremovable box survives the failure (success clears it via
// clearConsumedSourceStateAfterApply). CT-347: memory errors persist
// indefinitely (user must read which panels to close), others auto-dismiss.
function reportApplyFailedWithToast(
  action: RegisteredViewportAction,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
  error: unknown,
): void {
  const message = formatActionErrorMessage(action.label, error);
  if (error instanceof RasterMemoryAllocationError) {
    notifyPersistentError(message);
  } else {
    notifyError(message);
  }
  clearOperationRegionAtViewportIndex(sourceIndex, bindings);
  bindings.reportApplyOutcome?.({ succeeded: false });
}

// CT-268: a user-stopped apply is not a failure. It shows the transient
// "Operation stopped" toast, keeps the source's operation region (the user may
// re-apply), and reports a non-success so keepsPanelOpenUntilApplySucceeds
// panels stay open. Nothing was placed and no History was written, because the
// transform threw before any result landed.
function reportApplyEndedWithoutResult(
  action: RegisteredViewportAction,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
  error: unknown,
): void {
  if (isOperationStoppedError(error)) {
    toast.info(OPERATION_STOPPED_MESSAGE);
    bindings.reportApplyOutcome?.({ succeeded: false });
    return;
  }
  reportApplyFailedWithToast(action, sourceIndex, bindings, error);
}

// CT-268: one AbortController per stoppable apply run; its signal threads into
// the transform and its abort is offered as the busy overlay's Stop button.
function createStopControllerForStoppableApply(
  action: RegisteredViewportAction,
): AbortController | null {
  return action.supportsStopDuringApply ? new AbortController() : null;
}

// CT-269: every apply registers itself for its whole lifetime, so the close
// flow can refuse closing its source, cancel it through its stop controller
// when its target closes, and keep its indexes current across grid compaction.
function reserveInFlightApplyRun(
  action: RegisteredViewportAction,
  sourceIndex: number,
  targetIndex: number,
  stopController: AbortController | null,
  bindings: ApplyActionFlowBindings,
): InFlightApplyRunReservation {
  return bindings.inFlightApplyRuns.reserveApplyRun({
    sourceIndex,
    targetIndex,
    operationLabel: action.label,
    requestStop: stopController ? () => stopController.abort() : null,
  });
}

// A run whose target panel was closed mid-flight must discard its result even
// when the transform could not be aborted (non-stoppable actions, or an abort
// racing completion); surfacing it as a stop reuses the CT-268 ending.
function throwStoppedWhenApplyRunIsCancelled(reservation: InFlightApplyRunReservation): void {
  if (reservation.isCancelled()) throw new OperationStoppedError();
}

function listSourcesAcrossViewports(imagesByIndex: ViewportContentMap): ViewportImageSource[] {
  return [...imagesByIndex.values()].map((content) => content.source);
}

// Only non-transforming actions land here (the transforming ones are routed to
// the busy-indicator path above), so this path never touches the source.
function applyActionInPlaceWithoutBusyIndicator(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  try {
    writeAppliedRenderingStateInheritingFromSource(
      action,
      parameterValues,
      sourceIndex,
      sourceIndex,
      bindings,
    );
    const sourceContent = bindings.imagesByIndex.get(sourceIndex) ?? null;
    placeSecondaryActionOutputsInFreshViewports(action, parameterValues, sourceContent, sourceIndex, sourceIndex, bindings);
    reportApplySucceededWithToast(action, bindings, false);
  } catch (error) {
    reportApplyFailedWithToast(action, sourceIndex, bindings, error);
  }
}

async function runApplyActionInPlaceWithBusyIndicator(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): Promise<void> {
  const stopController = createStopControllerForStoppableApply(action);
  const reservation = reserveInFlightApplyRun(action, sourceIndex, sourceIndex, stopController, bindings);
  const handle = bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: sourceIndex,
    label: describeOperationLoadingMessage(action),
    requestStop: stopController ? () => stopController.abort() : undefined,
  });
  try {
    await yieldOnceSoBusyOverlayCanPaint();
    await transformSourceInPlaceAndFinishBookkeeping(action, parameterValues, sourceIndex, reservation, bindings, handle, stopController?.signal);
    reportApplySucceededWithToast(action, bindings, false);
  } catch (error) {
    reportApplyEndedWithoutResult(action, reservation.currentSourceIndex(), bindings, error);
  } finally {
    reservation.release();
    handle.clear();
  }
}

async function transformSourceInPlaceAndFinishBookkeeping(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  reservation: InFlightApplyRunReservation,
  bindings: ApplyActionFlowBindings,
  busyHandle: BusyEntryHandle,
  abortSignal?: AbortSignal,
): Promise<void> {
  const content = bindings.imagesByIndex.get(sourceIndex);
  if (!content) throw new Error(`No source loaded at viewport index ${sourceIndex}`);
  const nextSource = await replaceSourceContentWithTransformedSource(action, parameterValues, content, reservation, bindings, busyHandle, abortSignal);
  const currentIndex = reservation.currentSourceIndex();
  const geometry = { previousSource: content.source, nextSource };
  writeAppliedRenderingStateForInPlaceResult(action, parameterValues, currentIndex, geometry, bindings);
  placeSecondaryActionOutputsInFreshViewports(action, parameterValues, content, currentIndex, currentIndex, bindings);
}

function yieldOnceSoBusyOverlayCanPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// CT-290: the captured source is HELD for the transform's duration (a
// concurrent replace of the same panel must not detach it mid-read), and the
// replaced raster is QUEUED for deterministic buffer release once the write
// lands; App's post-commit flush detaches whatever the result did not carry
// over by reference.
async function replaceSourceContentWithTransformedSource(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  content: ViewportCellContent,
  reservation: InFlightApplyRunReservation,
  bindings: ApplyActionFlowBindings,
  busyHandle: BusyEntryHandle,
  abortSignal?: AbortSignal,
): Promise<ViewportImageSource | null> {
  if (!actionTransformsSource(action)) return null;
  const releaseSourceHold = holdSourceBuffersWhileInUse(content.source);
  try {
    return await transformAndReplaceHeldSourceContent(action, parameterValues, content, reservation, bindings, busyHandle, abortSignal);
  } finally {
    releaseSourceHold();
  }
}

async function transformAndReplaceHeldSourceContent(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  content: ViewportCellContent,
  reservation: InFlightApplyRunReservation,
  bindings: ApplyActionFlowBindings,
  busyHandle: BusyEntryHandle,
  abortSignal?: AbortSignal,
): Promise<ViewportImageSource> {
  const nextSource = await runActionSourceTransform(
    action,
    content.source,
    parameterValues,
    forwardTransformProgressToBusyEntry(busyHandle),
    abortSignal,
  );
  throwStoppedWhenApplyRunIsCancelled(reservation);
  const writeIndex = reservation.currentSourceIndex();
  bindings.setImagesByIndex((previous) =>
    writeViewportContentAtIndex(previous, writeIndex, { ...content, source: nextSource }),
  );
  queueOutgoingRasterSourceForBufferRelease(content.source);
  return nextSource;
}

// CT-221: async transforms report per-band progress; forwarding it to the busy
// entry turns the operation overlay's spinner into a percentage bar.
function forwardTransformProgressToBusyEntry(
  busyHandle: BusyEntryHandle,
): (fraction: number) => void {
  return (fraction) => busyHandle.update({ progress: fraction });
}

function writeAppliedRenderingStateInheritingFromSource(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const inherited = bindings.getRenderingState(sourceIndex);
  bindings.setRenderingState(
    targetIndex,
    applyActionAndTagOperationLabel(action, parameterValues, inherited),
  );
}

// CT-302: a result delivered to ANOTHER panel never carries the source panel's
// mask layers; the masks stay with the stack they were painted on.
function writeAppliedRenderingStateForResultInAnotherPanel(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  targetIndex: number,
  resultSource: ViewportImageSource | null,
  bindings: ApplyActionFlowBindings,
): void {
  const inherited = withoutMaskLayers(bindings.getRenderingState(sourceIndex));
  const applied = applyActionAndTagOperationLabel(action, parameterValues, inherited);
  bindings.setRenderingState(targetIndex, clampSelectedBandIndexToRaster(applied, resultSource));
}

function withoutMaskLayers(state: ViewportRenderingState): ViewportRenderingState {
  return { ...state, masks: EMPTY_MASK_PANEL_STATE };
}

interface InPlaceResultGeometry {
  readonly previousSource: ViewportImageSource;
  readonly nextSource: ViewportImageSource | null;
}

// CT-302: masks are pinned to the panel's spatial grid, so an in-place apply
// that moved or resized the stack carries them through the action's own
// spatial mapping (crop crops them, rotate rotates them, flip flips them);
// only a geometry change with no mapping drops them, and says so.
function writeAppliedRenderingStateForInPlaceResult(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  index: number,
  geometry: InPlaceResultGeometry,
  bindings: ApplyActionFlowBindings,
): void {
  const inherited = bindings.getRenderingState(index);
  const reconciled = withMasksCarriedAcrossGeometryChange(action, parameterValues, inherited, geometry);
  notifyWhenGeometryChangeRemovedMasks(inherited, reconciled);
  const applied = applyActionAndTagOperationLabel(action, parameterValues, reconciled);
  bindings.setRenderingState(index, clampSelectedBandIndexToRaster(applied, geometry.nextSource));
}

function withMasksCarriedAcrossGeometryChange(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  state: ViewportRenderingState,
  geometry: InPlaceResultGeometry,
): ViewportRenderingState {
  if (!geometry.nextSource) return state;
  const comparison = compareStackGeometryAcrossApply(action, geometry.previousSource, geometry.nextSource);
  const transform = action.describeMaskGeometryTransform?.(parameterValues) ?? null;
  return { ...state, masks: carryMasksAcrossStackGeometryChange(state.masks, comparison, transform) };
}

function compareStackGeometryAcrossApply(
  action: RegisteredViewportAction,
  previousSource: ViewportImageSource,
  nextSource: ViewportImageSource,
): StackGeometryComparison {
  const previous = getImageSourceDimensions(previousSource);
  const next = getImageSourceDimensions(nextSource);
  return {
    actionChangesStackGeometry: Boolean(action.changesStackGeometry),
    previousWidth: previous.width,
    previousHeight: previous.height,
    nextWidth: next.width,
    nextHeight: next.height,
  };
}

function notifyWhenGeometryChangeRemovedMasks(
  previous: ViewportRenderingState,
  next: ViewportRenderingState,
): void {
  if (!wereMasksDroppedByGeometryChange(previous.masks, next.masks)) return;
  toast.info(MASKS_REMOVED_BY_GEOMETRY_CHANGE_MESSAGE);
}

// CT-097: after the primary result lands, place each secondary output (e.g. the
// auto-normalized intermediate produced when inverting unbounded data) into its
// own fresh viewport, expanding the grid if needed. The source is untouched.
// CT-269: the ORIGINAL source content is passed in (captured before any
// transform), never re-read from the render-time map, so a mid-run index shift
// cannot make this derive from the wrong panel.
function placeSecondaryActionOutputsInFreshViewports(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent | null,
  sourceIndex: number,
  primaryTargetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  if (!action.transformSourceToSecondaryOutputs) return;
  if (!sourceContent) return;
  const outputs = action.transformSourceToSecondaryOutputs(sourceContent.source, parameterValues);
  placeEachSecondaryOutputInFreshViewport(action, parameterValues, sourceContent, outputs, sourceIndex, primaryTargetIndex, bindings);
}

function placeEachSecondaryOutputInFreshViewport(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  outputs: ReadonlyArray<ViewportActionOutput>,
  sourceIndex: number,
  primaryTargetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const reservedIndexes = new Set<number>([sourceIndex, primaryTargetIndex]);
  for (const output of outputs) {
    const targetIndex = reserveFreshViewportIndexExcluding(bindings, reservedIndexes);
    if (targetIndex === null) return;
    reservedIndexes.add(targetIndex);
    placeSecondaryOutputAtIndex(action, parameterValues, sourceContent, output, sourceIndex, targetIndex, bindings);
  }
}

function placeSecondaryOutputAtIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  output: ViewportActionOutput,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  bindings.setImagesByIndex((previous) =>
    writeViewportContentAtIndex(previous, targetIndex, { ...sourceContent, source: output.source }),
  );
  writeAppliedRenderingStateWithExplicitLabel(action, parameterValues, output.appliedLabel, sourceIndex, targetIndex, bindings);
}

// CT-316: the lowest free panel (respecting in-flight reservations), or the
// first cell of the next larger layout, or null when the grid is full at its
// largest. This is the same search applyActionToDuplicateOfSource runs before
// it falls through to the replace-target picker.
export function findOrOpenFreshResultPanelIndexOrNull(
  bindings: ApplyActionFlowBindings,
): number | null {
  return reserveFreshViewportIndexExcluding(bindings, NO_EXCLUDED_INDEXES);
}

const NO_EXCLUDED_INDEXES: ReadonlySet<number> = new Set();

function reserveFreshViewportIndexExcluding(
  bindings: ApplyActionFlowBindings,
  excludedIndexes: ReadonlySet<number>,
): number | null {
  const reservedTargets = bindings.inFlightApplyRuns.listReservedResultTargetIndexes();
  for (let index = 0; index < bindings.cellCount; index += 1) {
    if (bindings.imagesByIndex.has(index)) continue;
    if (excludedIndexes.has(index) || reservedTargets.has(index)) continue;
    return index;
  }
  return expandGridForOneMoreSecondaryOutput(bindings);
}

function expandGridForOneMoreSecondaryOutput(bindings: ApplyActionFlowBindings): number | null {
  const expanded = getNextLargerGridLayout(bindings.gridLayout);
  if (expanded === null) return null;
  bindings.setGridLayout(expanded);
  return bindings.cellCount;
}

function writeAppliedRenderingStateWithExplicitLabel(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  appliedLabel: string,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const inherited = withoutMaskLayers(bindings.getRenderingState(sourceIndex));
  bindings.setRenderingState(
    targetIndex,
    applyActionAndTagWithExplicitLabel(action, parameterValues, appliedLabel, inherited),
  );
}

function applyActionAndTagOperationLabel(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  previous: ViewportRenderingState,
): ViewportRenderingState {
  const appliedLabel = resolveAppliedLabelForActionAndParameters(action, parameterValues);
  return applyActionAndTagWithExplicitLabel(action, parameterValues, appliedLabel, previous);
}

function applyActionAndTagWithExplicitLabel(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  appliedLabel: string,
  previous: ViewportRenderingState,
): ViewportRenderingState {
  const applied = action.apply(previous, parameterValues);
  return {
    ...applied,
    lastAppliedOperationLabel: appliedLabel,
    operationHistory: appendOperationHistoryEntry(applied.operationHistory, {
      actionId: action.id,
      actionLabel: action.label,
      appliedLabel,
      parameterValues,
    }),
  };
}

function resolveAppliedLabelForActionAndParameters(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
): string {
  if (action.formatAppliedLabel) return action.formatAppliedLabel(parameterValues);
  return action.appliedLabel;
}

export function applyActionToDuplicateOfSource(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const sourceContent = bindings.imagesByIndex.get(sourceIndex);
  if (!sourceContent) return;
  if (reportActionCannotApplyToSourceBeforeOpeningPanel(action, sourceContent.source, parameterValues)) return;
  if (reportApplyExceedsMemoryBudget(action, sourceContent.source, parameterValues, sourceIndex, bindings)) return;
  if (tryDuplicateAndApplyInEmptyViewport(action, parameterValues, sourceContent, sourceIndex, bindings)) return;
  if (tryDuplicateAndApplyByExpandingGrid(action, parameterValues, sourceContent, sourceIndex, bindings)) return;
  bindings.setPendingDuplicate({
    sourceIndex,
    sourceContent,
    postDuplicateAction: { action, parameterValues },
  });
}

function tryDuplicateAndApplyInEmptyViewport(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): boolean {
  const empty = findLowestIndexEmptyViewport(
    bindings.imagesByIndex,
    bindings.cellCount,
    bindings.inFlightApplyRuns.listReservedResultTargetIndexes(),
  );
  if (empty === null) return false;
  void runDuplicateAndApplyAtTargetIndex(action, parameterValues, sourceContent, sourceIndex, empty, bindings);
  return true;
}

function tryDuplicateAndApplyByExpandingGrid(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): boolean {
  const expanded = getNextLargerGridLayout(bindings.gridLayout);
  if (expanded === null) return false;
  const newIndex = bindings.cellCount;
  bindings.setGridLayout(expanded);
  void runDuplicateAndApplyAtTargetIndex(
    action,
    parameterValues,
    sourceContent,
    sourceIndex,
    newIndex,
    bindings,
  );
  return true;
}

// CT-316: every menu operation selects the panel that received its result
// (CT-105); a ROP candidate delivery passes selectResultPanel: false so the
// source panel stays selected while the user keeps pressing.
export interface DuplicateApplyOptions {
  readonly selectResultPanel: boolean;
}

export const DEFAULT_DUPLICATE_APPLY_OPTIONS: DuplicateApplyOptions = {
  selectResultPanel: true,
};

export async function runDuplicateAndApplyAtTargetIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
  options: DuplicateApplyOptions = DEFAULT_DUPLICATE_APPLY_OPTIONS,
): Promise<void> {
  const stopController = createStopControllerForStoppableApply(action);
  const reservation = reserveInFlightApplyRun(action, sourceIndex, targetIndex, stopController, bindings);
  const handle = actionTransformsSource(action)
    ? registerResultPanelBusyEntry(action, targetIndex, bindings, stopController)
    : null;
  try {
    if (handle) await yieldOnceSoBusyOverlayCanPaint();
    const resultSource = await placeDuplicateOutputAtReservedTarget(action, parameterValues, sourceContent, reservation, bindings, handle, stopController?.signal);
    finishDuplicateApplyBookkeeping(action, parameterValues, sourceContent, resultSource, reservation, bindings, options);
    reportApplySucceededWithToast(action, bindings, resultLandedOutsideTheSourcePanel(reservation));
  } catch (error) {
    reportApplyEndedWithoutResult(action, reservation.currentSourceIndex(), bindings, error);
  } finally {
    reservation.release();
    handle?.clear();
  }
}

// CT-290: the captured source is held while the run reads it, so a concurrent
// in-place apply on the same panel cannot detach its buffers mid-transform.
async function placeDuplicateOutputAtReservedTarget(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  reservation: InFlightApplyRunReservation,
  bindings: ApplyActionFlowBindings,
  busyHandle: BusyEntryHandle | null,
  abortSignal?: AbortSignal,
): Promise<ViewportImageSource> {
  const releaseSourceHold = holdSourceBuffersWhileInUse(sourceContent.source);
  try {
    return await placeDuplicateOutputWhileSourceIsHeld(action, parameterValues, sourceContent, reservation, bindings, busyHandle, abortSignal);
  } finally {
    releaseSourceHold();
  }
}

async function placeDuplicateOutputWhileSourceIsHeld(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  reservation: InFlightApplyRunReservation,
  bindings: ApplyActionFlowBindings,
  busyHandle: BusyEntryHandle | null,
  abortSignal?: AbortSignal,
): Promise<ViewportImageSource> {
  if (actionTransformsSource(action) && busyHandle) {
    return await placeTransformedDuplicateAtReservedTarget(
      action,
      parameterValues,
      sourceContent,
      reservation,
      bindings,
      busyHandle,
      abortSignal,
    );
  }
  throwStoppedWhenApplyRunIsCancelled(reservation);
  return await placeClonedSourceContentAtIndex(sourceContent, reservation.currentTargetIndex(), bindings.setImagesByIndex);
}

function finishDuplicateApplyBookkeeping(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  resultSource: ViewportImageSource | null,
  reservation: InFlightApplyRunReservation,
  bindings: ApplyActionFlowBindings,
  options: DuplicateApplyOptions,
): void {
  const sourceIndex = reservation.currentSourceIndex();
  const targetIndex = reservation.currentTargetIndex();
  writeAppliedRenderingStateForResultInAnotherPanel(action, parameterValues, sourceIndex, targetIndex, resultSource, bindings);
  clearConsumedSourceStateAfterDuplicateApply(action, sourceIndex, targetIndex, bindings);
  placeSecondaryActionOutputsInFreshViewports(action, parameterValues, sourceContent, sourceIndex, targetIndex, bindings);
  if (options.selectResultPanel) selectResultPanelHoldingTheDuplicateOutput(targetIndex, bindings);
}

// CT-276: the duplicate path normally lands in a fresh panel, but the
// replace-target picker can point it back at the source panel itself; only a
// result living in ANOTHER panel leaves the original holding its memory.
function resultLandedOutsideTheSourcePanel(reservation: InFlightApplyRunReservation): boolean {
  return reservation.currentTargetIndex() !== reservation.currentSourceIndex();
}

function selectResultPanelHoldingTheDuplicateOutput(
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  bindings.selectViewportIndex?.(targetIndex);
}

// CT-106: the result lands in a freshly opened panel. When that panel is empty
// (no image to show under a delayed spinner) its loading state must paint
// immediately; an overwrite of an existing panel keeps the anti-flash delay.
function registerResultPanelBusyEntry(
  action: RegisteredViewportAction,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
  stopController: AbortController | null,
): BusyEntryHandle {
  const opensInNewEmptyPanel = !bindings.imagesByIndex.has(targetIndex);
  return bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: targetIndex,
    label: describeOperationLoadingMessage(action),
    immediate: shouldShowOperationLoadingImmediately({ opensInNewEmptyPanel }),
    requestStop: stopController ? () => stopController.abort() : undefined,
  });
}

function clearConsumedSourceStateAfterDuplicateApply(
  action: RegisteredViewportAction,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  if (!action.clearConsumedSourceStateAfterApply) return;
  if (sourceIndex === targetIndex) return;
  const current = bindings.getRenderingState(sourceIndex);
  bindings.setRenderingState(
    sourceIndex,
    action.clearConsumedSourceStateAfterApply(current),
  );
}

async function placeTransformedDuplicateAtReservedTarget(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  reservation: InFlightApplyRunReservation,
  bindings: ApplyActionFlowBindings,
  busyHandle: BusyEntryHandle,
  abortSignal?: AbortSignal,
): Promise<ViewportImageSource> {
  const transformedContent = await transformImmutableSourceContent(
    sourceContent,
    action,
    parameterValues,
    busyHandle,
    abortSignal,
  );
  throwStoppedWhenApplyRunIsCancelled(reservation);
  const writeIndex = reservation.currentTargetIndex();
  // CT-290/CT-276: the replace-target picker can point this write at an
  // occupied panel; queue whatever raster it held. Queueing is always safe -
  // the flush skips any buffer a live panel still references.
  queueOutgoingRasterSourceForBufferRelease(bindings.imagesByIndex.get(writeIndex)?.source);
  bindings.setImagesByIndex((previous) =>
    writeViewportContentAtIndex(previous, writeIndex, transformedContent),
  );
  return transformedContent.source;
}

// CT-233: the source is handed to the transform directly, with no defensive
// whole-cube clone. Transforms are bound by the immutability contract on
// ViewportActionSourceTransform, so a failure leaves the source panel intact
// and unchanged bands may be shared by reference between source and result.
async function transformImmutableSourceContent(
  sourceContent: ViewportCellContent,
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  busyHandle: BusyEntryHandle,
  abortSignal?: AbortSignal,
): Promise<ViewportCellContent> {
  const transformedSource = await runActionSourceTransform(
    action,
    sourceContent.source,
    parameterValues,
    forwardTransformProgressToBusyEntry(busyHandle),
    abortSignal,
  );
  return {
    fileName: sourceContent.fileName,
    source: transformedSource,
    originalFilePath: sourceContent.originalFilePath,
    fileSizeBytes: sourceContent.fileSizeBytes,
  };
}

function writeViewportContentAtIndex(
  previous: ViewportContentMap,
  index: number,
  next: ViewportCellContent,
): ViewportContentMap {
  const updated = new Map(previous);
  updated.set(index, next);
  return updated;
}

// CT-190: surface an unappliable operation (e.g. RGB-to-grayscale on a non-RGB
// image) as an error toast BEFORE any panel is reserved or the grid is expanded,
// so a failure opens no blank panel and records no History entry. Returns true
// when the apply flow must stop. CT-347: memory errors persist indefinitely.
function reportActionCannotApplyToSourceBeforeOpeningPanel(
  action: RegisteredViewportAction,
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
): boolean {
  if (!action.assertCanApplyToSource) return false;
  try {
    action.assertCanApplyToSource(source, parameterValues);
    return false;
  } catch (error) {
    const message = formatActionErrorMessage(action.label, error);
    if (error instanceof RasterMemoryAllocationError) {
      notifyPersistentError(message);
    } else {
      notifyError(message);
    }
    return true;
  }
}

function formatActionErrorMessage(actionLabel: string, error: unknown): string {
  return `${actionLabel} failed: ${describeUnknownError(error)}`;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
