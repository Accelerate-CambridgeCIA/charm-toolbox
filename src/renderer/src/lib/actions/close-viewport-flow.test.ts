import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import type { ViewportCellContent } from "@/components/viewport-grid";
import {
  buildViewportClosingApi,
  type ViewportClosingApiBindings,
} from "@/lib/actions/close-viewport-flow";
import { createInFlightApplyRunStore } from "@/lib/actions/in-flight-apply-run-store";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  releaseQueuedRasterBuffersSkippingShared,
  resetRasterBufferReleaseStateForTests,
} from "@/lib/image/raster-buffer-release";
import { buildTransientErrorToastOptions } from "@/lib/notifications/toast-options";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function rasterWithOneBand(band: Uint16Array): RasterImage {
  return {
    bandPixels: [band],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function contentHoldingRaster(raster: RasterImage, fileName: string): ViewportCellContent {
  return { fileName, source: { kind: "raster", raster }, fileSizeBytes: 8 };
}

interface CloseFlowHarness {
  readonly bindings: ViewportClosingApiBindings;
  readonly imagesByIndex: Map<number, ViewportCellContent>;
}

function buildCloseFlowHarness(contents: ReadonlyArray<ViewportCellContent>): CloseFlowHarness {
  const imagesByIndex = new Map(contents.map((content, index) => [index, content]));
  return {
    imagesByIndex,
    bindings: {
      gridLayout: "1x2",
      selectedIndices: new Set<number>(),
      imagesByIndex,
      setGridLayout: vi.fn(),
      setImagesByIndex: vi.fn(),
      pruneRenderingStateToCellCount: vi.fn(),
      compactRenderingStateAfterRemovingIndex: vi.fn(),
      pruneSelectionToCellCount: vi.fn(),
      compactSelectionAfterRemovingIndex: vi.fn(),
      pruneLinkGroupsToCellCount: vi.fn(),
      compactLinkGroupsAfterRemovingIndex: vi.fn(),
      replaceSelection: vi.fn(),
      inFlightApplyRuns: createInFlightApplyRunStore(),
    },
  };
}

function flushReleasesTreatingContentsAsLive(contents: ReadonlyArray<ViewportCellContent>): void {
  releaseQueuedRasterBuffersSkippingShared({
    liveSources: contents.map((content) => content.source),
    rememberedRasters: [],
  });
}

describe("close-viewport-flow buffer release (CT-290)", () => {
  beforeEach(() => {
    resetRasterBufferReleaseStateForTests();
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("queues the closed panel's raster so the flush detaches its buffers", () => {
    const closedBand = new Uint16Array(4);
    const survivingBand = new Uint16Array(4);
    const surviving = contentHoldingRaster(rasterWithOneBand(survivingBand), "keep.tif");
    const harness = buildCloseFlowHarness([
      contentHoldingRaster(rasterWithOneBand(closedBand), "close.tif"),
      surviving,
    ]);
    buildViewportClosingApi(harness.bindings).closeViewport(0);
    flushReleasesTreatingContentsAsLive([surviving]);
    expect(closedBand.buffer.byteLength).toBe(0);
    expect(survivingBand.buffer.byteLength).toBe(8);
    expect(toast.info).toHaveBeenCalledWith("Closed panel 1 (close.tif)");
  });

  it("skips a closed panel's band still shared by reference with another live panel", () => {
    const sharedBand = new Uint16Array(4);
    const surviving = contentHoldingRaster(rasterWithOneBand(sharedBand), "derived.tif");
    const harness = buildCloseFlowHarness([
      contentHoldingRaster(rasterWithOneBand(sharedBand), "source.tif"),
      surviving,
    ]);
    buildViewportClosingApi(harness.bindings).closeViewport(0);
    flushReleasesTreatingContentsAsLive([surviving]);
    expect(sharedBand.buffer.byteLength).toBe(8);
  });

  it("queues nothing when the close is refused because an operation reads the panel", () => {
    const band = new Uint16Array(4);
    const harness = buildCloseFlowHarness([
      contentHoldingRaster(rasterWithOneBand(band), "busy.tif"),
    ]);
    const reservation = harness.bindings.inFlightApplyRuns.reserveApplyRun({
      sourceIndex: 0,
      targetIndex: 1,
      operationLabel: "Rotate",
      requestStop: null,
    });
    buildViewportClosingApi(harness.bindings).closeViewport(0);
    flushReleasesTreatingContentsAsLive([]);
    expect(band.buffer.byteLength).toBe(8);
    expect(harness.bindings.setImagesByIndex).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Rotate"), buildTransientErrorToastOptions());
    reservation.release();
  });
});
