import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewportCellContent } from "@/components/viewport-grid";
import type { ApplyActionFlowBindings } from "@/lib/actions/apply-action-flow";
import { createInFlightApplyRunStore } from "@/lib/actions/in-flight-apply-run-store";
import { DEFAULT_VIEWPORT_RENDERING_STATE, type ViewportRenderingState } from "@/lib/actions/viewport-action";
import type { GridLayout } from "@/lib/grid/grid-layout";
import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";
import type { RasterImage } from "@/lib/image/raster-image";
import { buildErrorToastOptions } from "@/lib/notifications/toast-options";
import { toast } from "sonner";

import {
  buildRopCandidateDeliveryPort,
  canOpenFreshRopCandidatePanel,
  canRopRunDeliverSomewhere,
  deliverRopCandidateToPanel,
  isLiveCandidatePanelIntact,
  resolveRopCandidateReplaceIndexOrNull,
  ROP_PRESS_NEEDS_A_FREE_PANEL_MESSAGE,
  type RopLiveCandidatePanel,
} from "./rop-candidate-delivery";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// The toast mock is module-level, so a test asserting a message was NOT raised
// needs the previous tests' calls cleared.
beforeEach(() => {
  vi.clearAllMocks();
});

function rasterOf(values: number[]): RasterImage {
  return makeFloat32RasterFromBands({ width: values.length, height: 1 }, [Float32Array.from(values)]);
}

function panelWith(raster: RasterImage): ViewportCellContent {
  return { fileName: "stack.tif", source: { kind: "raster", raster } };
}

const SOURCE_INDEX = 0;
const CANDIDATE_INDEX = 1;

describe("isLiveCandidatePanelIntact / resolveRopCandidateReplaceIndexOrNull", () => {
  const delivered = rasterOf([1, 2]);
  const live: RopLiveCandidatePanel = { viewportIndex: CANDIDATE_INDEX, raster: delivered };

  it("recognises the panel that still holds the delivered raster (same identity)", () => {
    const panels = new Map([[CANDIDATE_INDEX, panelWith(delivered)]]);
    expect(isLiveCandidatePanelIntact(live, panels)).toBe(true);
    expect(resolveRopCandidateReplaceIndexOrNull(live, panels)).toBe(CANDIDATE_INDEX);
  });

  it("drops the pointer when the panel was closed", () => {
    const panels = new Map<number, ViewportCellContent>();
    expect(isLiveCandidatePanelIntact(live, panels)).toBe(false);
    expect(resolveRopCandidateReplaceIndexOrNull(live, panels)).toBeNull();
  });

  it("drops the pointer when the panel holds a different stack (even with equal values)", () => {
    const panels = new Map([[CANDIDATE_INDEX, panelWith(rasterOf([1, 2]))]]);
    expect(isLiveCandidatePanelIntact(live, panels)).toBe(false);
    expect(resolveRopCandidateReplaceIndexOrNull(live, panels)).toBeNull();
  });

  it("drops the pointer when the panel holds a non-raster source", () => {
    const panels = new Map<number, ViewportCellContent>([
      [CANDIDATE_INDEX, { fileName: "photo.png", source: { kind: "image-bitmap", image: {} as ImageBitmap } }],
    ]);
    expect(isLiveCandidatePanelIntact(live, panels)).toBe(false);
  });

  it("has nothing to replace without a pointer", () => {
    expect(isLiveCandidatePanelIntact(null, new Map())).toBe(false);
    expect(resolveRopCandidateReplaceIndexOrNull(null, new Map())).toBeNull();
  });
});

function bindingsWith(
  gridLayout: GridLayout,
  cellCount: number,
  occupiedIndexes: number[],
): ApplyActionFlowBindings {
  const imagesByIndex = new Map<number, ViewportCellContent>(
    occupiedIndexes.map((index) => [index, panelWith(rasterOf([10, 20]))]),
  );
  const renderingByIndex = new Map<number, ViewportRenderingState>();
  return {
    gridLayout,
    cellCount,
    imagesByIndex,
    setGridLayout: vi.fn(),
    setImagesByIndex: vi.fn((updater) => {
      for (const [index, content] of updater(imagesByIndex)) imagesByIndex.set(index, content);
    }),
    setPendingDuplicate: vi.fn(),
    getRenderingState: (index) => renderingByIndex.get(index) ?? DEFAULT_VIEWPORT_RENDERING_STATE,
    setRenderingState: (index, next) => renderingByIndex.set(index, next),
    selectViewportIndex: vi.fn(),
    busyRegistrar: {
      registerAppBusyEntry: () => NOOP_HANDLE,
      registerViewportBusyEntry: () => NOOP_HANDLE,
    },
    inFlightApplyRuns: createInFlightApplyRunStore(),
  };
}

const NOOP_HANDLE = { id: "test", update: () => undefined, clear: () => undefined };

const REQUEST = {
  seed: 7,
  values: Float32Array.from([3, 4]),
  width: 2,
  height: 1,
  score: null,
  objectiveLabel: null,
};

describe("canOpenFreshRopCandidatePanel", () => {
  it("allows a press while a free panel or a larger layout exists", () => {
    expect(canOpenFreshRopCandidatePanel(bindingsWith("1x2", 2, [0]))).toBe(true);
    expect(canOpenFreshRopCandidatePanel(bindingsWith("1x1", 1, [0]))).toBe(true);
  });

  it("refuses when every panel is in use and no larger layout exists", () => {
    expect(canOpenFreshRopCandidatePanel(bindingsWith("3x2", 6, [0, 1, 2, 3, 4, 5]))).toBe(false);
    expect(canOpenFreshRopCandidatePanel(bindingsWith("2x3", 6, [0, 1, 2, 3, 4, 5]))).toBe(false);
  });
});

describe("canRopRunDeliverSomewhere", () => {
  it("can deliver by replacing the live candidate panel, whether or not a fresh one could also open", () => {
    expect(canRopRunDeliverSomewhere(CANDIDATE_INDEX, true)).toBe(true);
    expect(canRopRunDeliverSomewhere(CANDIDATE_INDEX, false)).toBe(true);
  });

  it("can deliver by opening a fresh panel when there is no live candidate to replace", () => {
    expect(canRopRunDeliverSomewhere(null, true)).toBe(true);
  });

  it("refuses when there is nothing to replace and no fresh panel can open", () => {
    expect(canRopRunDeliverSomewhere(null, false)).toBe(false);
  });
});

describe("deliverRopCandidateToPanel", () => {
  it("opens the lowest free panel with a one-band float copy and reports it as the live panel", async () => {
    const bindings = bindingsWith("1x2", 2, [SOURCE_INDEX]);
    const live = await deliverRopCandidateToPanel(REQUEST, SOURCE_INDEX, null, bindings);
    expect(live?.viewportIndex).toBe(CANDIDATE_INDEX);
    const placed = bindings.imagesByIndex.get(CANDIDATE_INDEX)?.source;
    expect(placed?.kind === "raster" && placed.raster).toBe(live?.raster);
    expect(live?.raster).toMatchObject({ width: 2, height: 1, bandCount: 1, sampleFormat: "float" });
    expect(Array.from(live?.raster.bandPixels[0] ?? [])).toEqual([3, 4]);
    expect(live?.raster.bandPixels[0]?.buffer).not.toBe(REQUEST.values.buffer);
    expect(toast.success).toHaveBeenCalledWith("Projection ready", expect.anything());
  });

  it("never moves the selection to the candidate panel", async () => {
    const bindings = bindingsWith("1x2", 2, [SOURCE_INDEX]);
    await deliverRopCandidateToPanel(REQUEST, SOURCE_INDEX, null, bindings);
    expect(bindings.selectViewportIndex).not.toHaveBeenCalled();
  });

  it("replaces the live candidate panel in place when asked to", async () => {
    const bindings = bindingsWith("1x2", 2, [SOURCE_INDEX, CANDIDATE_INDEX]);
    const before = bindings.imagesByIndex.get(CANDIDATE_INDEX)?.source;
    const live = await deliverRopCandidateToPanel(REQUEST, SOURCE_INDEX, CANDIDATE_INDEX, bindings);
    expect(live?.viewportIndex).toBe(CANDIDATE_INDEX);
    expect(bindings.imagesByIndex.get(CANDIDATE_INDEX)?.source).not.toBe(before);
    expect(bindings.setGridLayout).not.toHaveBeenCalled();
  });

  it("expands the grid when no panel is free but a larger layout exists", async () => {
    const bindings = bindingsWith("1x1", 1, [SOURCE_INDEX]);
    const live = await deliverRopCandidateToPanel(REQUEST, SOURCE_INDEX, null, bindings);
    expect(bindings.setGridLayout).toHaveBeenCalledWith("1x2");
    expect(live?.viewportIndex).toBe(1);
  });

  it("refuses with the locked toast when the largest grid is full", async () => {
    const bindings = bindingsWith("3x2", 6, [0, 1, 2, 3, 4, 5]);
    const live = await deliverRopCandidateToPanel(REQUEST, SOURCE_INDEX, null, bindings);
    expect(live).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      ROP_PRESS_NEEDS_A_FREE_PANEL_MESSAGE,
      buildErrorToastOptions(),
    );
    expect(bindings.setPendingDuplicate).not.toHaveBeenCalled();
  });

  it("announces a frozen delivery as kept, not merely ready", async () => {
    const bindings = bindingsWith("1x2", 2, [SOURCE_INDEX]);
    await deliverRopCandidateToPanel(REQUEST, SOURCE_INDEX, null, bindings, "frozen");
    expect(toast.success).toHaveBeenCalledWith("Projection kept", expect.anything());
    expect(toast.success).not.toHaveBeenCalledWith("Projection ready", expect.anything());
  });

  it("gives a frozen delivery the same stack and History entry as a candidate one", async () => {
    const bindings = bindingsWith("1x2", 2, [SOURCE_INDEX]);
    const live = await deliverRopCandidateToPanel(REQUEST, SOURCE_INDEX, null, bindings, "frozen");
    expect(Array.from(live?.raster.bandPixels[0] ?? [])).toEqual([3, 4]);
    const history = bindings.getRenderingState(CANDIDATE_INDEX).operationHistory;
    expect(history.map((entry) => entry.appliedLabel)).toEqual(["ROP (seed 7)"]);
  });

  it("writes the source's History plus one ROP entry on the candidate panel", async () => {
    const bindings = bindingsWith("1x2", 2, [SOURCE_INDEX]);
    await deliverRopCandidateToPanel(REQUEST, SOURCE_INDEX, null, bindings);
    const history = bindings.getRenderingState(CANDIDATE_INDEX).operationHistory;
    expect(history.map((entry) => entry.appliedLabel)).toEqual(["ROP (seed 7)"]);
  });
});

describe("buildRopCandidateDeliveryPort", () => {
  it("delivers nothing while the aside has no pinned source", async () => {
    const port = buildRopCandidateDeliveryPort(null, bindingsWith("1x2", 2, [SOURCE_INDEX]));
    expect(await port.deliverCandidate(REQUEST, null)).toBeNull();
  });

  it("answers the pointer check and the refusal predicate from the bindings", () => {
    const bindings = bindingsWith("3x2", 6, [0, 1, 2, 3, 4, 5]);
    const port = buildRopCandidateDeliveryPort(SOURCE_INDEX, bindings);
    const source = bindings.imagesByIndex.get(CANDIDATE_INDEX)?.source;
    const raster = source?.kind === "raster" ? source.raster : null;
    if (raster === null) throw new Error("expected a raster panel");
    expect(port.resolveReplaceIndexOrNull({ viewportIndex: CANDIDATE_INDEX, raster })).toBe(CANDIDATE_INDEX);
    expect(port.canOpenFreshCandidatePanel()).toBe(false);
  });
});
