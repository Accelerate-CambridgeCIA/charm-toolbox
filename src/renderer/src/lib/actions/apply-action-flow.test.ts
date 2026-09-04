import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import type { ViewportCellContent } from "@/components/viewport-grid";
import { OPERATION_STOPPED_MESSAGE } from "@/lib/image/operation-stop";
import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import { reportCompletedUnitAndYieldSoProgressCanPaint } from "@/lib/image/unit-progress";
import { buildTransientErrorToastOptions } from "@/lib/notifications/toast-options";
import {
  queueOutgoingRasterSourceForBufferRelease,
  releaseQueuedRasterBuffersSkippingShared,
  resetRasterBufferReleaseStateForTests,
} from "@/lib/image/raster-buffer-release";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import { addNewMaskLayerToPanel, EMPTY_MASK_PANEL_STATE } from "@/lib/masks/mask-panel";
import { MASKS_REMOVED_BY_GEOMETRY_CHANGE_MESSAGE } from "@/lib/masks/mask-geometry-change";
import { applyGeometricTransformToPlane } from "@/lib/image/apply-geometric-transform";

import {
  applyActionInPlaceAtSourceIndex,
  applyActionToDuplicateOfSource,
  runDuplicateAndApplyAtTargetIndex,
  type ApplyActionFlowBindings,
} from "./apply-action-flow";
import {
  BAND_SELECTION_ACTION,
  createBandSelectionSourceTransform,
} from "./band-selection-action";
import { createInFlightApplyRunStore } from "./in-flight-apply-run-store";
import {
  EMPTY_OPERATION_HISTORY,
  type ViewportOperationHistory,
} from "./operation-history";
import type { RasterImage } from "@/lib/image/raster-image";

import { NO_PARAMETER_VALUES, type ParameterValuesById } from "./parameter-schema";
import { INVERT_ACTION, type RegisteredViewportAction } from "./registered-actions";
import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  EMPTY_REMOVED_BAND_INDEXES,
  EMPTY_TONE_CURVE_CHANNEL_ANCHORS,
  type ViewportRenderingState,
} from "./viewport-action";
import type { ViewportRoi } from "@/lib/image/viewport-roi";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe("runDuplicateAndApplyAtTargetIndex", () => {
  it("inherits the source viewport's operation history when duplicating to a new viewport", async () => {
    const sourcePriorHistory = buildHistoryWithEntries(["normalize", "bit-shift"]);
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory });
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    const targetWrite = harness.findLatestRenderingStateWriteAtIndex(TARGET_INDEX);
    expect(targetWrite.operationHistory.map((entry) => entry.actionId)).toEqual([
      "normalize",
      "bit-shift",
      "normalize",
    ]);
  });

  it("does not modify the source viewport's history when duplicating", async () => {
    const sourcePriorHistory = buildHistoryWithEntries(["normalize"]);
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory });
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.bindings.setRenderingState).not.toHaveBeenCalledWith(
      SOURCE_INDEX,
      expect.anything(),
    );
  });
});

describe("runDuplicateAndApplyAtTargetIndex with clearConsumedSourceStateAfterApply", () => {
  it("clears consumed source state on the source viewport in the duplicate flow", async () => {
    const sourcePriorHistory = buildHistoryWithEntries(["normalize"]);
    const sampleRoi = buildSampleRoi();
    const harness = buildDuplicateFlowHarnessWithSourceRoi({ sourcePriorHistory, sourceRoi: sampleRoi });
    await runDuplicateAndApplyAtTargetIndex(
      buildCropLikeActionThatClearsSourceRoi(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    const sourceWrite = harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX);
    expect(sourceWrite.roi).toBeNull();
    expect(sourceWrite.operationHistory.map((entry) => entry.actionId)).toEqual(["normalize"]);
  });

  it("does not write source state when sourceIndex equals targetIndex (in-place via duplicate path)", async () => {
    const sourcePriorHistory = buildHistoryWithEntries([]);
    const harness = buildDuplicateFlowHarnessWithSourceRoi({
      sourcePriorHistory,
      sourceRoi: buildSampleRoi(),
    });
    await runDuplicateAndApplyAtTargetIndex(
      buildCropLikeActionThatClearsSourceRoi(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      SOURCE_INDEX,
      harness.bindings,
    );
    const setRenderingStateMock = harness.bindings.setRenderingState as unknown as {
      mock: { calls: ReadonlyArray<[number, ViewportRenderingState]> };
    };
    const sourceWrites = setRenderingStateMock.mock.calls.filter(
      ([index]) => index === SOURCE_INDEX,
    );
    expect(sourceWrites).toHaveLength(1);
  });
});

describe("applyActionInPlaceAtSourceIndex", () => {
  it("appends a new history entry to the source's existing history", () => {
    const sourcePriorHistory = buildHistoryWithEntries(["bit-shift"]);
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory });
    applyActionInPlaceAtSourceIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    const sourceWrite = harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX);
    expect(sourceWrite.operationHistory.map((entry) => entry.actionId)).toEqual([
      "bit-shift",
      "normalize",
    ]);
  });
});

describe("runDuplicateAndApplyAtTargetIndex selecting the result panel (CT-105)", () => {
  it("selects the new target panel after placing the result", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const selectViewportIndex = vi.fn();
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      { ...harness.bindings, selectViewportIndex },
    );
    expect(selectViewportIndex).toHaveBeenCalledWith(TARGET_INDEX);
  });

  it("does not select a panel when the duplicate apply fails", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const selectViewportIndex = vi.fn();
    await runDuplicateAndApplyAtTargetIndex(
      buildActionThatThrowsOnTransform(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      { ...harness.bindings, selectViewportIndex },
    );
    expect(selectViewportIndex).not.toHaveBeenCalled();
  });

  // CT-316: the ROP candidate delivery opts out so the source panel stays
  // selected while the user keeps pressing; the result still lands.
  it("leaves the selection alone when selectResultPanel is false", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const selectViewportIndex = vi.fn();
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      { ...harness.bindings, selectViewportIndex },
      { selectResultPanel: false },
    );
    expect(selectViewportIndex).not.toHaveBeenCalled();
    expect(harness.findLatestRenderingStateWriteAtIndex(TARGET_INDEX).normalizationEnabled).toBe(true);
  });
});

describe("runDuplicateAndApplyAtTargetIndex result-panel loading state (CT-106)", () => {
  it("registers an immediate, operation-specific loading entry for a new empty result panel", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const records: RecordedBusyEntryInput[] = [];
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeActionThatTransforms(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      { ...harness.bindings, busyRegistrar: buildRecordingBusyEntryRegistrar(records) },
    );
    expect(records).toContainEqual({
      viewportIndex: TARGET_INDEX,
      label: "Normalizing...",
      immediate: true,
    });
  });

  it("defers the loading entry (not immediate) when the result overwrites an occupied panel", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const records: RecordedBusyEntryInput[] = [];
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeActionThatTransforms(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      SOURCE_INDEX,
      { ...harness.bindings, busyRegistrar: buildRecordingBusyEntryRegistrar(records) },
    );
    expect(records).toContainEqual({
      viewportIndex: SOURCE_INDEX,
      label: "Normalizing...",
      immediate: false,
    });
  });
});

describe("runDuplicateAndApplyAtTargetIndex with transformSourceToSecondaryOutputs", () => {
  it("places each secondary output in its own fresh viewport with its own label and history", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    await runDuplicateAndApplyAtTargetIndex(
      buildInvertLikeActionWithSecondaryOutput(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    const secondaryWrite = harness.findLatestRenderingStateWriteAtIndex(SECONDARY_OUTPUT_INDEX);
    expect(secondaryWrite.lastAppliedOperationLabel).toBe("Normalize to [0,1] (auto for invert)");
    expect(secondaryWrite.operationHistory.map((entry) => entry.appliedLabel)).toEqual([
      "Normalize to [0,1] (auto for invert)",
    ]);
  });

  it("leaves the source viewport untouched while emitting a secondary output", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    await runDuplicateAndApplyAtTargetIndex(
      buildInvertLikeActionWithSecondaryOutput(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.bindings.setRenderingState).not.toHaveBeenCalledWith(
      SOURCE_INDEX,
      expect.anything(),
    );
  });
});

describe("applyActionToDuplicateOfSource with assertCanApplyToSource (CT-190)", () => {
  it("opens no panel and writes no rendering state when the source is unappliable", () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    vi.mocked(toast.error).mockClear();
    applyActionToDuplicateOfSource(
      buildActionThatRejectsSource(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    expect(harness.bindings.setImagesByIndex).not.toHaveBeenCalled();
    expect(harness.bindings.setRenderingState).not.toHaveBeenCalled();
    expect(harness.bindings.setGridLayout).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Reject Source failed: not appliable",
      buildTransientErrorToastOptions(),
    );
  });
});

const SOURCE_INDEX = 0;
const TARGET_INDEX = 1;
const SECONDARY_OUTPUT_INDEX = 2;

interface DuplicateFlowHarness {
  readonly bindings: ApplyActionFlowBindings;
  readonly findLatestRenderingStateWriteAtIndex: (index: number) => ViewportRenderingState;
}

interface DuplicateFlowHarnessOptions {
  readonly sourcePriorHistory: ViewportOperationHistory;
}

function buildDuplicateFlowHarness(options: DuplicateFlowHarnessOptions): DuplicateFlowHarness {
  const renderingByIndex = new Map<number, ViewportRenderingState>([
    [SOURCE_INDEX, buildRenderingStateWithHistory(options.sourcePriorHistory)],
  ]);
  const setRenderingState = vi.fn(
    (index: number, next: ViewportRenderingState) => renderingByIndex.set(index, next),
  );
  const bindings = buildBindingsBackedByMaps(renderingByIndex, setRenderingState);
  return { bindings, findLatestRenderingStateWriteAtIndex: (i) => readLatestWrite(setRenderingState, i) };
}

function buildBindingsBackedByMaps(
  renderingByIndex: Map<number, ViewportRenderingState>,
  setRenderingState: ApplyActionFlowBindings["setRenderingState"],
): ApplyActionFlowBindings {
  const imagesByIndex = new Map<number, ViewportCellContent>([
    [SOURCE_INDEX, buildSinglePixelCellContent()],
  ]);
  return {
    gridLayout: "1x2",
    cellCount: 2,
    imagesByIndex,
    setGridLayout: vi.fn(),
    setImagesByIndex: vi.fn((updater) => updater(imagesByIndex)),
    setPendingDuplicate: vi.fn(),
    getRenderingState: (index) =>
      renderingByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
    setRenderingState,
    busyRegistrar: buildNoopBusyEntryRegistrarForTests(),
    inFlightApplyRuns: createInFlightApplyRunStore(),
  };
}

function buildNoopBusyEntryRegistrarForTests(): ApplyActionFlowBindings["busyRegistrar"] {
  const noopHandle = { id: "test", update: () => undefined, clear: () => undefined };
  return {
    registerAppBusyEntry: () => noopHandle,
    registerViewportBusyEntry: () => noopHandle,
  };
}

function readLatestWrite(
  setRenderingState: ApplyActionFlowBindings["setRenderingState"],
  index: number,
): ViewportRenderingState {
  const mock = setRenderingState as unknown as { mock: { calls: ReadonlyArray<[number, ViewportRenderingState]> } };
  const matching = mock.mock.calls.filter(([writtenIndex]) => writtenIndex === index);
  const last = matching[matching.length - 1];
  if (!last) throw new Error(`Expected a setRenderingState write at index ${index}`);
  return last[1];
}

function buildRenderingStateWithHistory(
  history: ViewportOperationHistory,
): ViewportRenderingState {
  return {
    normalizationEnabled: false,
    viewChannelsSeparately: false,
    lastAppliedOperationLabel: null,
    selectedBandIndex: 0,
    operationHistory: history,
    roi: null,
    operationRegion: null,
    toneCurveAnchors: null,
    toneCurveChannelAnchors: EMPTY_TONE_CURVE_CHANNEL_ANCHORS,
    toneCurveActiveChannel: "rgb",
    thresholdBounds: null,
    bandWeights: null,
    bandSelection: null,
    cubeTransform: null,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
    masks: EMPTY_MASK_PANEL_STATE,
  };
}

function buildHistoryWithEntries(actionIds: ReadonlyArray<string>): ViewportOperationHistory {
  return actionIds.map((id, index) => ({
    actionId: id,
    actionLabel: id,
    appliedLabel: id,
    parameterValues: {},
    timestampMs: 1_000 + index,
  }));
}

function buildNormalizeAction(): RegisteredViewportAction {
  return {
    id: "normalize",
    label: "Normalize",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Normalized",
    apply: (state: ViewportRenderingState) => ({ ...state, normalizationEnabled: true }),
  } as unknown as RegisteredViewportAction;
}

interface RecordedBusyEntryInput {
  readonly viewportIndex: number;
  readonly label: string;
  readonly immediate: boolean;
}

function buildRecordingBusyEntryRegistrar(
  records: RecordedBusyEntryInput[],
): ApplyActionFlowBindings["busyRegistrar"] {
  const noopHandle = { id: "test", update: () => undefined, clear: () => undefined };
  return {
    registerAppBusyEntry: () => noopHandle,
    registerViewportBusyEntry: (input) => {
      records.push({
        viewportIndex: input.viewportIndex,
        label: input.label,
        immediate: input.immediate ?? false,
      });
      return noopHandle;
    },
  };
}

function buildNormalizeActionThatTransforms(): RegisteredViewportAction {
  return {
    id: "normalize-data",
    label: "Normalize",
    loadingMessage: "Normalizing...",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Normalized",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => buildSinglePixelSource(),
  } as unknown as RegisteredViewportAction;
}

function buildInvertLikeActionWithSecondaryOutput(): RegisteredViewportAction {
  return {
    id: "invert",
    label: "Invert",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Invert",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => buildSinglePixelSource(),
    transformSourceToSecondaryOutputs: () => [
      { source: buildSinglePixelSource(), appliedLabel: "Normalize to [0,1] (auto for invert)" },
    ],
  } as unknown as RegisteredViewportAction;
}

function buildActionThatThrowsOnTransform(): RegisteredViewportAction {
  return {
    id: "throws",
    label: "Throws",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Throws",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => {
      throw new Error("boom");
    },
  } as unknown as RegisteredViewportAction;
}

function buildActionThatRejectsSource(): RegisteredViewportAction {
  return {
    id: "reject-source",
    label: "Reject Source",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Rejected",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => buildSinglePixelSource(),
    assertCanApplyToSource: () => {
      throw new Error("not appliable");
    },
  } as unknown as RegisteredViewportAction;
}

function buildSinglePixelCellContent(): ViewportCellContent {
  return {
    fileName: "test.png",
    source: buildSinglePixelSource(),
    fileSizeBytes: 4,
  };
}

function buildSinglePixelSource(): ViewportImageSource {
  return {
    kind: "pixels",
    pixels: new Uint8ClampedArray([0, 0, 0, 255]),
    width: 1,
    height: 1,
  };
}

interface DuplicateFlowHarnessWithRoiOptions {
  readonly sourcePriorHistory: ViewportOperationHistory;
  readonly sourceRoi: ViewportRoi;
}

function buildDuplicateFlowHarnessWithSourceRoi(
  options: DuplicateFlowHarnessWithRoiOptions,
): DuplicateFlowHarness {
  const initialSource = {
    ...buildRenderingStateWithHistory(options.sourcePriorHistory),
    roi: options.sourceRoi,
  };
  const renderingByIndex = new Map<number, ViewportRenderingState>([[SOURCE_INDEX, initialSource]]);
  const setRenderingState = vi.fn((index: number, next: ViewportRenderingState) =>
    renderingByIndex.set(index, next),
  );
  const bindings = buildBindingsBackedByMaps(renderingByIndex, setRenderingState);
  return {
    bindings,
    findLatestRenderingStateWriteAtIndex: (i) => readLatestWrite(setRenderingState, i),
  };
}

// CT-324: L2 Minimization, Local PCA/MNF and ROP hand back a stack with fewer
// bands than the one they read, so a selected band index the result does not
// have must not ride across the apply ("Band index 279 out of range").
describe("clamping the selected band index to the result raster (CT-324)", () => {
  it("writes band 0 to the target when a band-reducing duplicate apply inherits an out-of-range index", async () => {
    const harness = buildBandReducingFlowHarnessSelectingBandIndex(279);
    await runDuplicateAndApplyAtTargetIndex(
      buildBandReducingActionYieldingOneBand(),
      NO_PARAMETER_VALUES,
      buildThreeBandUint16RasterCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(TARGET_INDEX).selectedBandIndex).toBe(0);
  });

  it("keeps an in-range index across a duplicate apply that keeps every band", async () => {
    const harness = buildBandReducingFlowHarnessSelectingBandIndex(2);
    await runDuplicateAndApplyAtTargetIndex(
      buildActionYieldingTheSameThreeBands(),
      NO_PARAMETER_VALUES,
      buildThreeBandUint16RasterCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(TARGET_INDEX).selectedBandIndex).toBe(2);
  });

  it("writes band 0 in place when a band-reducing apply replaces the stack of the panel it ran on", async () => {
    const harness = buildBandReducingFlowHarnessSelectingBandIndex(279);
    applyActionInPlaceAtSourceIndex(
      buildBandReducingActionYieldingOneBand(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await waitForPendingApplyWork();
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).selectedBandIndex).toBe(0);
  });

  it("leaves the index alone when the duplicated result is not a raster", async () => {
    const harness = buildBandReducingFlowHarnessSelectingBandIndex(279);
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeAction(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(TARGET_INDEX).selectedBandIndex).toBe(279);
  });
});

function buildBandReducingFlowHarnessSelectingBandIndex(
  selectedBandIndex: number,
): DuplicateFlowHarness {
  const initial = { ...buildRenderingStateWithHistory([]), selectedBandIndex };
  const renderingByIndex = new Map<number, ViewportRenderingState>([[SOURCE_INDEX, initial]]);
  const setRenderingState = vi.fn((index: number, next: ViewportRenderingState) =>
    renderingByIndex.set(index, next),
  );
  const bindings = buildRasterBindingsBackedByMaps(renderingByIndex, setRenderingState);
  return {
    bindings,
    findLatestRenderingStateWriteAtIndex: (i) => readLatestWrite(setRenderingState, i),
  };
}

function buildRasterBindingsBackedByMaps(
  renderingByIndex: Map<number, ViewportRenderingState>,
  setRenderingState: ApplyActionFlowBindings["setRenderingState"],
): ApplyActionFlowBindings {
  let imagesByIndex: ReadonlyMap<number, ViewportCellContent> = new Map([
    [SOURCE_INDEX, buildThreeBandUint16RasterCellContent()],
  ]);
  return {
    gridLayout: "1x2",
    cellCount: 2,
    get imagesByIndex() {
      return imagesByIndex;
    },
    setGridLayout: vi.fn(),
    setImagesByIndex: (updater) => {
      imagesByIndex = updater(imagesByIndex);
    },
    setPendingDuplicate: vi.fn(),
    getRenderingState: (index) => renderingByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
    setRenderingState,
    busyRegistrar: buildNoopBusyEntryRegistrarForTests(),
    inFlightApplyRuns: createInFlightApplyRunStore(),
  };
}

function buildBandReducingActionYieldingOneBand(): RegisteredViewportAction {
  return {
    id: "l2-like",
    label: "L2 Minimization",
    loadingMessage: "Minimizing...",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "L2 Minimization",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => ({ kind: "raster", raster: buildOneBandFloat32Raster() }),
  } as unknown as RegisteredViewportAction;
}

function buildActionYieldingTheSameThreeBands(): RegisteredViewportAction {
  return {
    id: "three-band-like",
    label: "Invert",
    loadingMessage: "Inverting...",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Invert",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => ({ kind: "raster", raster: buildThreeBandUint16Raster() }),
  } as unknown as RegisteredViewportAction;
}

function buildOneBandFloat32Raster(): RasterImage {
  return {
    bandPixels: [new Float32Array([1, 2, 3, 4])],
    width: 2,
    height: 2,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: 1,
  };
}

function waitForPendingApplyWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("transform progress reaching the busy entry (CT-221)", () => {
  it("forwards transformSourceAsync progress ticks to the busy entry as progress updates", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    const progressUpdates: number[] = [];
    const bindings = {
      ...harness.bindings,
      busyRegistrar: buildProgressRecordingBusyEntryRegistrar(progressUpdates),
    };
    await runDuplicateAndApplyAtTargetIndex(
      buildActionReportingTransformProgress([0, 0.5, 1]),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      bindings,
    );
    expect(progressUpdates).toEqual([0, 0.5, 1]);
  });
});

function buildProgressRecordingBusyEntryRegistrar(
  progressUpdates: number[],
): ApplyActionFlowBindings["busyRegistrar"] {
  const handle = {
    id: "test",
    update: (next: { progress?: number | null }) => {
      if (typeof next.progress === "number") progressUpdates.push(next.progress);
    },
    clear: () => undefined,
  };
  return { registerAppBusyEntry: () => handle, registerViewportBusyEntry: () => handle };
}

function buildActionReportingTransformProgress(
  ticks: ReadonlyArray<number>,
): RegisteredViewportAction {
  return {
    id: "progressive",
    label: "Progressive",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Progressive",
    apply: (state: ViewportRenderingState) => state,
    transformSourceAsync: async (
      _source: ViewportImageSource,
      _parameterValues: unknown,
      onProgress?: (fraction: number) => void,
    ) => {
      for (const tick of ticks) onProgress?.(tick);
      return buildSinglePixelSource();
    },
  } as unknown as RegisteredViewportAction;
}

describe("apply without the whole-cube clone (CT-233)", () => {
  it("carries unchanged bands into the duplicate result by the SAME references after a single-band op", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const harness = buildRasterDuplicateFlowHarness(content);
    await runDuplicateAndApplyAtTargetIndex(
      INVERT_ACTION,
      buildInvertBandZeroParameterValues(),
      content,
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    const resultRaster = readRasterAtIndexOrThrow(harness, TARGET_INDEX);
    expect(resultRaster.bandPixels[1]).toBe(sourceRaster.bandPixels[1]);
    expect(resultRaster.bandPixels[2]).toBe(sourceRaster.bandPixels[2]);
    expect(resultRaster.bandPixels[0]).not.toBe(sourceRaster.bandPixels[0]);
    expect(Array.from(resultRaster.bandPixels[0]!)).toEqual([65435, 65335, 65235, 65135]);
  });

  it("leaves the source raster's band contents unchanged after an all-bands op", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const bandSnapshots = sourceRaster.bandPixels.map((band) => Array.from(band));
    const harness = buildRasterDuplicateFlowHarness(content);
    await runDuplicateAndApplyAtTargetIndex(
      INVERT_ACTION,
      buildInvertAllBandsParameterValues(),
      content,
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.readContentAtIndex(SOURCE_INDEX)).toBe(content);
    sourceRaster.bandPixels.forEach((band, index) => {
      expect(Array.from(band)).toEqual(bandSnapshots[index]);
    });
  });

  it("leaves the source panel untouched when a duplicate-path transform throws", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const bandSnapshots = sourceRaster.bandPixels.map((band) => Array.from(band));
    const harness = buildRasterDuplicateFlowHarness(content);
    await runDuplicateAndApplyAtTargetIndex(
      buildActionThatThrowsOnTransform(),
      NO_PARAMETER_VALUES,
      content,
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.readContentAtIndex(SOURCE_INDEX)).toBe(content);
    expect(harness.readContentAtIndex(TARGET_INDEX)).toBeUndefined();
    sourceRaster.bandPixels.forEach((band, index) => {
      expect(Array.from(band)).toEqual(bandSnapshots[index]);
    });
  });

  it("leaves the source panel untouched when an in-place transform throws", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const bandSnapshots = sourceRaster.bandPixels.map((band) => Array.from(band));
    const harness = buildRasterDuplicateFlowHarness(content);
    vi.mocked(toast.error).mockClear();
    applyActionInPlaceAtSourceIndex(
      buildActionThatThrowsOnTransform(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Throws failed: boom", buildTransientErrorToastOptions()),
    );
    expect(harness.readContentAtIndex(SOURCE_INDEX)).toBe(content);
    sourceRaster.bandPixels.forEach((band, index) => {
      expect(Array.from(band)).toEqual(bandSnapshots[index]);
    });
  });
});

interface RasterDuplicateFlowHarness {
  readonly bindings: ApplyActionFlowBindings;
  readonly readContentAtIndex: (index: number) => ViewportCellContent | undefined;
}

function buildRasterDuplicateFlowHarness(
  sourceContent: ViewportCellContent,
): RasterDuplicateFlowHarness {
  let imagesByIndex: ReadonlyMap<number, ViewportCellContent> = new Map([
    [SOURCE_INDEX, sourceContent],
  ]);
  const bindings: ApplyActionFlowBindings = {
    ...buildRasterHarnessRenderingBindings(),
    gridLayout: "1x2",
    cellCount: 2,
    get imagesByIndex() {
      return imagesByIndex;
    },
    setImagesByIndex: (updater) => {
      imagesByIndex = updater(imagesByIndex);
    },
    inFlightApplyRuns: createInFlightApplyRunStore(),
  };
  return { bindings, readContentAtIndex: (index) => imagesByIndex.get(index) };
}

type RasterHarnessRenderingBindings = Pick<
  ApplyActionFlowBindings,
  "setGridLayout" | "setPendingDuplicate" | "getRenderingState" | "setRenderingState" | "busyRegistrar"
>;

function buildRasterHarnessRenderingBindings(): RasterHarnessRenderingBindings {
  const renderingByIndex = new Map<number, ViewportRenderingState>([
    [SOURCE_INDEX, buildRenderingStateWithHistory([])],
  ]);
  return {
    setGridLayout: vi.fn(),
    setPendingDuplicate: vi.fn(),
    getRenderingState: (index) => renderingByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
    setRenderingState: vi.fn((index, next) => renderingByIndex.set(index, next)),
    busyRegistrar: buildNoopBusyEntryRegistrarForTests(),
  };
}

function buildThreeBandUint16RasterCellContent(): ViewportCellContent {
  return {
    fileName: "stack.tif",
    source: { kind: "raster", raster: buildThreeBandUint16Raster() },
    fileSizeBytes: 24,
  };
}

function buildThreeBandUint16Raster(): RasterImage {
  return {
    bandPixels: [
      new Uint16Array([100, 200, 300, 400]),
      new Uint16Array([500, 600, 700, 800]),
      new Uint16Array([900, 1000, 1100, 1200]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
  };
}

function readRasterFromCellContentOrThrow(content: ViewportCellContent): RasterImage {
  if (content.source.kind !== "raster") throw new Error("Expected a raster source");
  return content.source.raster;
}

function readRasterAtIndexOrThrow(
  harness: RasterDuplicateFlowHarness,
  index: number,
): RasterImage {
  const content = harness.readContentAtIndex(index);
  if (!content) throw new Error(`Expected viewport content at index ${index}`);
  return readRasterFromCellContentOrThrow(content);
}

function buildInvertBandZeroParameterValues(): ParameterValuesById {
  return Object.freeze({ applyToAllBands: false, targetBandIndex: 0 });
}

function buildInvertAllBandsParameterValues(): ParameterValuesById {
  return Object.freeze({ applyToAllBands: true });
}

function buildSampleRoi(): ViewportRoi {
  return { imagePixelX0: 1, imagePixelY0: 2, imagePixelX1: 4, imagePixelY1: 6 };
}

function buildCropLikeActionThatClearsSourceRoi(): RegisteredViewportAction {
  return {
    id: "crop-like",
    label: "Crop Like",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Cropped",
    apply: (state: ViewportRenderingState) => ({ ...state, roi: null }),
    clearConsumedSourceStateAfterApply: (state: ViewportRenderingState) => ({
      ...state,
      roi: null,
    }),
  } as unknown as RegisteredViewportAction;
}

describe("apply failure clears the operation region (CT-261)", () => {
  it("clears the source's operation region when an in-place apply fails", () => {
    const harness = buildFlowHarnessWithSourceOperationRegion();
    applyActionInPlaceAtSourceIndex(
      buildActionThatThrowsOnApply(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).operationRegion).toBeNull();
  });

  it("clears the source's operation region when a duplicate-flow transform fails", async () => {
    const harness = buildFlowHarnessWithSourceOperationRegion();
    await runDuplicateAndApplyAtTargetIndex(
      buildActionThatThrowsOnTransform(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).operationRegion).toBeNull();
  });

  it("leaves the region's sibling inspection ROI untouched when clearing on failure", () => {
    const harness = buildFlowHarnessWithSourceOperationRegion();
    applyActionInPlaceAtSourceIndex(
      buildActionThatThrowsOnApply(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).roi).toEqual(buildSampleRoi());
  });
});

function buildFlowHarnessWithSourceOperationRegion(): DuplicateFlowHarness {
  const initialSource = {
    ...buildRenderingStateWithHistory([]),
    roi: buildSampleRoi(),
    operationRegion: buildSampleRoi(),
  };
  const renderingByIndex = new Map<number, ViewportRenderingState>([[SOURCE_INDEX, initialSource]]);
  const setRenderingState = vi.fn((index: number, next: ViewportRenderingState) =>
    renderingByIndex.set(index, next),
  );
  const bindings = buildBindingsBackedByMaps(renderingByIndex, setRenderingState);
  return {
    bindings,
    findLatestRenderingStateWriteAtIndex: (i) => readLatestWrite(setRenderingState, i),
  };
}

function buildActionThatThrowsOnApply(): RegisteredViewportAction {
  return {
    id: "throws-on-apply",
    label: "Throws On Apply",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Throws",
    apply: () => {
      throw new Error("boom");
    },
  } as unknown as RegisteredViewportAction;
}

// --- CT-268: Stop button / abort token -------------------------------------

describe("stoppable applies (CT-268)", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.info).mockClear();
  });

  it("offers the busy entry a requestStop for a stoppable action and none otherwise", async () => {
    const stopHarness = buildStopFlowHarness();
    await runDuplicateAndApplyAtTargetIndex(
      buildStoppableActionCheckingTheSignalEachUnit(3),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      stopHarness.bindings,
    );
    expect(stopHarness.capturedRequestStops).toHaveLength(1);
    expect(stopHarness.capturedRequestStops[0]).toBeTypeOf("function");

    const plainHarness = buildStopFlowHarness();
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeActionThatTransforms(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      plainHarness.bindings,
    );
    expect(plainHarness.capturedRequestStops).toEqual([undefined]);
  });

  it("a stop mid-run cancels the chunked sweep, opens no panel, writes no History, and toasts 'Operation stopped'", async () => {
    const harness = buildStopFlowHarness({ clickStopAfterFirstProgressTick: true });
    const completedUnits: number[] = [];
    await runDuplicateAndApplyAtTargetIndex(
      buildStoppableActionCheckingTheSignalEachUnit(5, completedUnits),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(completedUnits.length).toBeLessThan(5);
    expect(toast.info).toHaveBeenCalledWith(OPERATION_STOPPED_MESSAGE);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(harness.bindings.setImagesByIndex).not.toHaveBeenCalled();
    expect(harness.bindings.setRenderingState).not.toHaveBeenCalled();
    expect(harness.clearedBusyEntryCount()).toBe(1);
    expect(harness.reportedOutcomes).toEqual([{ succeeded: false }]);
  });

  it("a stopped in-place apply keeps the source untouched and reports no success", async () => {
    const harness = buildStopFlowHarness({ clickStopAfterFirstProgressTick: true });
    applyActionInPlaceAtSourceIndex(
      buildStoppableActionCheckingTheSignalEachUnit(5),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() => expect(harness.clearedBusyEntryCount()).toBe(1));
    expect(toast.info).toHaveBeenCalledWith(OPERATION_STOPPED_MESSAGE);
    expect(harness.bindings.setImagesByIndex).not.toHaveBeenCalled();
    expect(harness.bindings.setRenderingState).not.toHaveBeenCalled();
    expect(harness.reportedOutcomes).toEqual([{ succeeded: false }]);
  });

  it("a stoppable action that finishes without a stop still lands its result normally", async () => {
    const harness = buildStopFlowHarness();
    await runDuplicateAndApplyAtTargetIndex(
      buildStoppableActionCheckingTheSignalEachUnit(3),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(toast.success).toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(harness.bindings.setImagesByIndex).toHaveBeenCalled();
    expect(harness.reportedOutcomes).toEqual([{ succeeded: true }]);
  });
});

interface StopFlowHarness {
  readonly bindings: ApplyActionFlowBindings;
  readonly capturedRequestStops: Array<(() => void) | undefined>;
  readonly clearedBusyEntryCount: () => number;
  readonly reportedOutcomes: Array<{ succeeded: boolean }>;
}

interface StopFlowHarnessOptions {
  readonly clickStopAfterFirstProgressTick?: boolean;
}

// The registrar records each entry's requestStop; with the click option it
// "presses Stop" as soon as the first progress update arrives, so the abort
// lands while the chunked sweep is mid-run.
function buildStopFlowHarness(options: StopFlowHarnessOptions = {}): StopFlowHarness {
  const capturedRequestStops: Array<(() => void) | undefined> = [];
  const reportedOutcomes: Array<{ succeeded: boolean }> = [];
  let clearedCount = 0;
  const renderingByIndex = new Map<number, ViewportRenderingState>([
    [SOURCE_INDEX, buildRenderingStateWithHistory([])],
  ]);
  const bindings: ApplyActionFlowBindings = {
    ...buildBindingsBackedByMaps(renderingByIndex, vi.fn()),
    setImagesByIndex: vi.fn(),
    busyRegistrar: {
      registerAppBusyEntry: () => ({ id: "app", update: () => undefined, clear: () => undefined }),
      registerViewportBusyEntry: (input) => {
        capturedRequestStops.push(input.requestStop);
        return buildStopClickingBusyHandle(input.requestStop, options, () => {
          clearedCount += 1;
        });
      },
    },
    reportApplyOutcome: (outcome) => reportedOutcomes.push(outcome),
  };
  return { bindings, capturedRequestStops, clearedBusyEntryCount: () => clearedCount, reportedOutcomes };
}

function buildStopClickingBusyHandle(
  requestStop: (() => void) | undefined,
  options: StopFlowHarnessOptions,
  recordClear: () => void,
): { id: string; update: () => void; clear: () => void } {
  let hasClickedStop = false;
  return {
    id: "viewport",
    update: () => {
      if (!options.clickStopAfterFirstProgressTick || hasClickedStop) return;
      hasClickedStop = true;
      requestStop?.();
    },
    clear: recordClear,
  };
}

// The transform sweeps its units through the shared chunk-boundary helper, so
// the abort check runs exactly where every real chunked operation checks it.
function buildStoppableActionCheckingTheSignalEachUnit(
  totalUnits: number,
  completedUnits: number[] = [],
): RegisteredViewportAction {
  return {
    id: "stoppable",
    label: "Stoppable",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Stoppable",
    apply: (state: ViewportRenderingState) => state,
    supportsStopDuringApply: true,
    transformSourceAsync: async (
      _source: ViewportImageSource,
      _parameterValues: unknown,
      onProgress?: (fraction: number) => void,
      abortSignal?: AbortSignal,
    ) => {
      for (let unit = 1; unit <= totalUnits; unit += 1) {
        completedUnits.push(unit);
        await reportCompletedUnitAndYieldSoProgressCanPaint(onProgress, unit, totalUnits, abortSignal);
      }
      return buildSinglePixelSource();
    },
  } as unknown as RegisteredViewportAction;
}

// --- CT-269: applies stay isolated while another operation runs -------------

describe("in-flight apply isolation (CT-269)", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.info).mockClear();
  });

  it("a second apply started while the first is in flight reserves a distinct panel", async () => {
    const harness = buildConcurrentApplyHarness();
    const first = buildActionWithDeferredAsyncTransform();
    const second = buildActionWithDeferredAsyncTransform();
    applyActionToDuplicateOfSource(first.action, NO_PARAMETER_VALUES, SOURCE_INDEX, harness.bindings);
    applyActionToDuplicateOfSource(second.action, NO_PARAMETER_VALUES, SOURCE_INDEX, harness.bindings);
    expect(harness.records.map((record) => record.viewportIndex)).toEqual([1, 2]);
    await first.resolveNextTransform();
    await second.resolveNextTransform();
    await vi.waitFor(() => {
      expect(harness.readContentAtIndex(1)).toBeDefined();
      expect(harness.readContentAtIndex(2)).toBeDefined();
    });
    expect(harness.bindings.inFlightApplyRuns.listReservedResultTargetIndexes()).toEqual(new Set());
  });

  it("closing the reserved target mid-run discards the completed result and reports a stop", async () => {
    const harness = buildConcurrentApplyHarness();
    const deferred = buildActionWithDeferredAsyncTransform();
    const runPromise = runDuplicateAndApplyAtTargetIndex(
      deferred.action,
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.bindings.inFlightApplyRuns.cancelAndStopApplyRunsTargetingIndex(TARGET_INDEX)).toBe(true);
    await deferred.resolveNextTransform();
    await runPromise;
    expect(harness.readContentAtIndex(TARGET_INDEX)).toBeUndefined();
    expect(toast.info).toHaveBeenCalledWith(OPERATION_STOPPED_MESSAGE);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(harness.bindings.inFlightApplyRuns.listReservedResultTargetIndexes()).toEqual(new Set());
  });

  it("an unrelated panel close mid-run shifts the result to the target's new index", async () => {
    const harness = buildConcurrentApplyHarness([
      [0, buildSinglePixelCellContent()],
      [1, buildSinglePixelCellContent()],
    ]);
    const deferred = buildActionWithDeferredAsyncTransform();
    const runPromise = runDuplicateAndApplyAtTargetIndex(
      deferred.action,
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      1,
      2,
      harness.bindings,
    );
    harness.simulateCompactingCloseOfViewport(0);
    await deferred.resolveNextTransform();
    await runPromise;
    expect(harness.readContentAtIndex(1)).toBeDefined();
    expect(harness.readContentAtIndex(2)).toBeUndefined();
    expect(toast.success).toHaveBeenCalled();
  });
});

interface ConcurrentApplyHarness {
  readonly bindings: ApplyActionFlowBindings;
  readonly records: RecordedBusyEntryInput[];
  readonly readContentAtIndex: (index: number) => ViewportCellContent | undefined;
  readonly simulateCompactingCloseOfViewport: (index: number) => void;
}

function buildConcurrentApplyHarness(
  initialEntries: ReadonlyArray<[number, ViewportCellContent]> = [
    [SOURCE_INDEX, buildSinglePixelCellContent()],
  ],
): ConcurrentApplyHarness {
  let imagesByIndex: ReadonlyMap<number, ViewportCellContent> = new Map(initialEntries);
  const records: RecordedBusyEntryInput[] = [];
  const bindings: ApplyActionFlowBindings = {
    ...buildRasterHarnessRenderingBindings(),
    gridLayout: "2x2",
    cellCount: 4,
    get imagesByIndex() {
      return imagesByIndex;
    },
    setImagesByIndex: (updater) => {
      imagesByIndex = updater(imagesByIndex);
    },
    busyRegistrar: buildRecordingBusyEntryRegistrar(records),
    inFlightApplyRuns: createInFlightApplyRunStore(),
  };
  const simulateCompactingCloseOfViewport = (index: number): void => {
    imagesByIndex = compactMapAfterRemovingIndexForTests(imagesByIndex, index);
    bindings.inFlightApplyRuns.shiftApplyRunIndexesAfterViewportRemoved(index);
  };
  return {
    bindings,
    records,
    readContentAtIndex: (index) => imagesByIndex.get(index),
    simulateCompactingCloseOfViewport,
  };
}

function compactMapAfterRemovingIndexForTests(
  previous: ReadonlyMap<number, ViewportCellContent>,
  removedIndex: number,
): ReadonlyMap<number, ViewportCellContent> {
  const compacted = new Map<number, ViewportCellContent>();
  for (const [index, content] of previous) {
    if (index === removedIndex) continue;
    compacted.set(index > removedIndex ? index - 1 : index, content);
  }
  return compacted;
}

// The flow yields once before invoking the transform, so resolving must first
// WAIT for the transform to have started (its resolver to exist).
function buildActionWithDeferredAsyncTransform(): {
  action: RegisteredViewportAction;
  resolveNextTransform: () => Promise<void>;
} {
  const pendingResolvers: Array<(source: ViewportImageSource) => void> = [];
  const action = {
    id: "deferred",
    label: "Deferred",
    loadingMessage: "Working...",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Deferred",
    apply: (state: ViewportRenderingState) => state,
    transformSourceAsync: () =>
      new Promise<ViewportImageSource>((resolve) => {
        pendingResolvers.push(resolve);
      }),
  } as unknown as RegisteredViewportAction;
  const resolveNextTransform = async (): Promise<void> => {
    await vi.waitFor(() => {
      if (pendingResolvers.length === 0) throw new Error("transform has not started yet");
    });
    pendingResolvers.shift()?.(buildSinglePixelSource());
  };
  return { action, resolveNextTransform };
}

// --- CT-276: new-panel success hint ----------------------------------------

describe("new-panel success hint (CT-276)", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
  });

  it("appends the hint to the success toast when the result lands in another panel", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    await runDuplicateAndApplyAtTargetIndex(
      buildCropLikeActionWithNewPanelHint(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Crop to region applied. Closing the original panel frees its memory.",
      expect.anything(),
    );
  });

  it("toasts the plain message when the duplicate path replaces the source panel itself", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    await runDuplicateAndApplyAtTargetIndex(
      buildCropLikeActionWithNewPanelHint(),
      NO_PARAMETER_VALUES,
      buildSinglePixelCellContent(),
      SOURCE_INDEX,
      SOURCE_INDEX,
      harness.bindings,
    );
    expect(toast.success).toHaveBeenCalledWith("Crop to region applied", expect.anything());
  });

  it("toasts the plain message for an in-place apply", async () => {
    const harness = buildDuplicateFlowHarness({ sourcePriorHistory: buildHistoryWithEntries([]) });
    applyActionInPlaceAtSourceIndex(
      buildCropLikeActionWithNewPanelHint(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Crop to region applied", expect.anything()),
    );
  });
});

function buildCropLikeActionWithNewPanelHint(): RegisteredViewportAction {
  return {
    id: "crop-like",
    label: "Crop to Region",
    icon: () => null,
    successMessage: "Crop to region applied",
    successHintWhenResultOpensNewPanel: "Closing the original panel frees its memory.",
    appliedLabel: "Crop to region",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => buildSinglePixelSource(),
  } as unknown as RegisteredViewportAction;
}

describe("a failing band-selection script leaves no result panel (CT-293)", () => {
  it("places nothing and leaves the source untouched when the Python run fails", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const harness = buildRasterDuplicateFlowHarness(content);
    await runDuplicateAndApplyAtTargetIndex(
      buildBandSelectionActionWithFailingScript(),
      { customBandExpression: "cub[1]" },
      content,
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.readContentAtIndex(TARGET_INDEX)).toBeUndefined();
    expect(harness.readContentAtIndex(SOURCE_INDEX)).toBe(content);
  });
});

function buildBandSelectionActionWithFailingScript(): RegisteredViewportAction {
  return {
    ...BAND_SELECTION_ACTION,
    transformSourceAsync: createBandSelectionSourceTransform(async () => ({
      status: "failed",
      message: "NameError: name 'cub' is not defined",
    })),
  };
}

describe("deterministic buffer release on replace (CT-290)", () => {
  beforeEach(() => {
    resetRasterBufferReleaseStateForTests();
    vi.mocked(toast.success).mockClear();
  });

  it("in-place apply queues the replaced raster; flush detaches unshared bands and skips carried-over ones", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const harness = buildRasterDuplicateFlowHarness(content);
    applyActionInPlaceAtSourceIndex(
      buildActionThatCarriesBandZeroThroughByReference(sourceRaster),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    flushBufferReleasesTreatingHarnessPanelsAsLive(harness);
    expect(sourceRaster.bandPixels[0]!.buffer.byteLength).toBe(8);
    expect(sourceRaster.bandPixels[1]!.buffer.byteLength).toBe(0);
    expect(sourceRaster.bandPixels[2]!.buffer.byteLength).toBe(0);
  });

  it("holds the captured source while the transform runs, so a concurrent release cannot detach it", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const harness = buildRasterDuplicateFlowHarness(content);
    const transformGate = buildManuallyResolvedTransformGate();
    applyActionInPlaceAtSourceIndex(
      transformGate.action,
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() => expect(transformGate.transformHasStarted()).toBe(true));
    queueOutgoingRasterSourceForBufferRelease(content.source);
    releaseQueuedRasterBuffersSkippingShared({ liveSources: [], rememberedRasters: [] });
    expect(sourceRaster.bandPixels[0]!.buffer.byteLength).toBe(8);
    transformGate.resolveWithFreshSinglePixelSource();
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    releaseQueuedRasterBuffersSkippingShared({ liveSources: [], rememberedRasters: [] });
    expect(sourceRaster.bandPixels[0]!.buffer.byteLength).toBe(0);
  });

  it("duplicate path pointed back at the source panel (replace picker) queues the replaced raster", async () => {
    const content = buildThreeBandUint16RasterCellContent();
    const sourceRaster = readRasterFromCellContentOrThrow(content);
    const harness = buildRasterDuplicateFlowHarness(content);
    await runDuplicateAndApplyAtTargetIndex(
      buildNormalizeActionThatTransforms(),
      NO_PARAMETER_VALUES,
      content,
      SOURCE_INDEX,
      SOURCE_INDEX,
      harness.bindings,
    );
    flushBufferReleasesTreatingHarnessPanelsAsLive(harness);
    sourceRaster.bandPixels.forEach((band) => expect(band.buffer.byteLength).toBe(0));
  });
});

function flushBufferReleasesTreatingHarnessPanelsAsLive(harness: RasterDuplicateFlowHarness): void {
  const liveSources = [SOURCE_INDEX, TARGET_INDEX]
    .map((index) => harness.readContentAtIndex(index)?.source)
    .filter((source): source is ViewportImageSource => source !== undefined);
  releaseQueuedRasterBuffersSkippingShared({ liveSources, rememberedRasters: [] });
}

function buildActionThatCarriesBandZeroThroughByReference(
  sourceRaster: RasterImage,
): RegisteredViewportAction {
  return {
    id: "carry-band-zero",
    label: "Carry",
    loadingMessage: "Carrying...",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Carried",
    apply: (state: ViewportRenderingState) => state,
    transformSource: () => ({
      kind: "raster",
      raster: {
        ...sourceRaster,
        bandPixels: [sourceRaster.bandPixels[0]!, new Uint16Array(4), new Uint16Array(4)],
      },
    }),
  } as unknown as RegisteredViewportAction;
}

interface ManuallyResolvedTransformGate {
  readonly action: RegisteredViewportAction;
  readonly transformHasStarted: () => boolean;
  readonly resolveWithFreshSinglePixelSource: () => void;
}

function buildManuallyResolvedTransformGate(): ManuallyResolvedTransformGate {
  let resolveTransform: (source: ViewportImageSource) => void = () => undefined;
  let started = false;
  const pendingSource = new Promise<ViewportImageSource>((resolve) => {
    resolveTransform = resolve;
  });
  const action = {
    id: "gated",
    label: "Gated",
    loadingMessage: "Running...",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Gated",
    apply: (state: ViewportRenderingState) => state,
    transformSourceAsync: () => {
      started = true;
      return pendingSource;
    },
  } as unknown as RegisteredViewportAction;
  return {
    action,
    transformHasStarted: () => started,
    resolveWithFreshSinglePixelSource: () => resolveTransform(buildSinglePixelSource()),
  };
}

void EMPTY_OPERATION_HISTORY;

// CT-302: masks are pinned to the panel's spatial grid. A value operation
// leaves them alone; an apply whose action maps the geometry change (crop,
// rotate, flip) carries them through that mapping; a geometry change with no
// mapping drops them with an info toast; a result delivered to another panel
// never carries them.
describe("mask layers across an apply (CT-302)", () => {
  beforeEach(() => {
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  it("keeps the panel's masks when an in-place value operation leaves the geometry alone", async () => {
    const harness = buildMaskFlowHarness();
    applyActionInPlaceAtSourceIndex(
      buildValueOnlyTransformAction(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).masks.layers).toHaveLength(1);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("carries the panel's masks through an action that maps the geometry change", async () => {
    const harness = buildMaskFlowHarness(buildRenderingStateWithPaintedMaskLayer());
    applyActionInPlaceAtSourceIndex(
      buildGeometryChangingActionCarryingMasksFlippedHorizontally(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    const masks = harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).masks;
    expect(masks.layers).toHaveLength(1);
    expect(Array.from(masks.layers[0]!.values)).toEqual([0, 1, 2, 0]);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("drops the panel's masks and says so when an in-place apply changes the geometry with no mapping", async () => {
    const harness = buildMaskFlowHarness();
    applyActionInPlaceAtSourceIndex(
      buildGeometryChangingTransformAction(),
      NO_PARAMETER_VALUES,
      SOURCE_INDEX,
      harness.bindings,
    );
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(harness.findLatestRenderingStateWriteAtIndex(SOURCE_INDEX).masks).toEqual(
      EMPTY_MASK_PANEL_STATE,
    );
    expect(toast.info).toHaveBeenCalledWith(MASKS_REMOVED_BY_GEOMETRY_CHANGE_MESSAGE);
  });

  it("never carries the source panel's masks into a result delivered to another panel", async () => {
    const harness = buildMaskFlowHarness();
    await runDuplicateAndApplyAtTargetIndex(
      buildValueOnlyTransformAction(),
      NO_PARAMETER_VALUES,
      buildThreeBandUint16RasterCellContent(),
      SOURCE_INDEX,
      TARGET_INDEX,
      harness.bindings,
    );
    expect(harness.findLatestRenderingStateWriteAtIndex(TARGET_INDEX).masks).toEqual(
      EMPTY_MASK_PANEL_STATE,
    );
  });
});

interface MaskFlowHarness {
  readonly bindings: ApplyActionFlowBindings;
  readonly findLatestRenderingStateWriteAtIndex: (index: number) => ViewportRenderingState;
}

function buildMaskFlowHarness(
  sourceRenderingState: ViewportRenderingState = buildRenderingStateWithOneMaskLayer(),
): MaskFlowHarness {
  const bindings = buildMaskFlowBindings(sourceRenderingState);
  return {
    bindings,
    findLatestRenderingStateWriteAtIndex: (index) =>
      readLatestWrite(bindings.setRenderingState, index),
  };
}

function buildMaskFlowBindings(
  sourceRenderingState: ViewportRenderingState,
): ApplyActionFlowBindings {
  const renderingByIndex = new Map<number, ViewportRenderingState>([
    [SOURCE_INDEX, sourceRenderingState],
  ]);
  let imagesByIndex: ReadonlyMap<number, ViewportCellContent> = new Map([
    [SOURCE_INDEX, buildThreeBandUint16RasterCellContent()],
  ]);
  return {
    ...buildRasterHarnessRenderingBindings(),
    gridLayout: "1x2",
    cellCount: 2,
    get imagesByIndex() {
      return imagesByIndex;
    },
    setImagesByIndex: (updater) => {
      imagesByIndex = updater(imagesByIndex);
    },
    getRenderingState: (index) => renderingByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
    setRenderingState: vi.fn((index, next) => renderingByIndex.set(index, next)),
    inFlightApplyRuns: createInFlightApplyRunStore(),
  };
}

function buildRenderingStateWithOneMaskLayer(): ViewportRenderingState {
  return {
    ...buildRenderingStateWithHistory([]),
    masks: addNewMaskLayerToPanel(EMPTY_MASK_PANEL_STATE, 2, 2),
  };
}

function buildValueOnlyTransformAction(): RegisteredViewportAction {
  return {
    id: "value-only",
    label: "Value Only",
    icon: () => null,
    successMessage: "ok",
    appliedLabel: "Value only",
    apply: (state: ViewportRenderingState) => state,
    transformSource: (source: ViewportImageSource) => source,
  } as unknown as RegisteredViewportAction;
}

// Same-size output, like a flip or a rotation of a square stack: only the
// action's own declaration marks it as a geometry change.
function buildGeometryChangingTransformAction(): RegisteredViewportAction {
  return {
    ...buildValueOnlyTransformAction(),
    id: "geometry-changing",
    label: "Geometry Changing",
    changesStackGeometry: true,
  } as unknown as RegisteredViewportAction;
}

function buildGeometryChangingActionCarryingMasksFlippedHorizontally(): RegisteredViewportAction {
  return {
    ...buildGeometryChangingTransformAction(),
    id: "geometry-mapping",
    label: "Geometry Mapping",
    describeMaskGeometryTransform: () => (plane: { values: Uint8Array; width: number; height: number }) =>
      applyGeometricTransformToPlane(plane.values, plane.width, plane.height, "flip-horizontal"),
  } as unknown as RegisteredViewportAction;
}

function buildRenderingStateWithPaintedMaskLayer(): ViewportRenderingState {
  const state = buildRenderingStateWithOneMaskLayer();
  const layer = state.masks.layers[0]!;
  const painted = { ...layer, values: Uint8Array.from([1, 0, 0, 2]) };
  return { ...state, masks: { ...state.masks, layers: [painted] } };
}
