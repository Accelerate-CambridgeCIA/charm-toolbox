import { describe, expect, it } from "vitest";

import {
  buildSpectrumLinePathFromValues,
  buildSpectrumStandardDeviationBandPath,
  computeSpectrumPlotValueRange,
  computeSpectrumPlotXRange,
  DEFAULT_SPECTRUM_PLOT_PADDING,
  resolveXTickLabelAnchor,
  type SpectrumPlotDimensions,
} from "@/lib/image/spectrum-plot-geometry";
import { listContiguousBandRuns } from "@/lib/image/spectrum-band-gaps";

const DIMENSIONS: SpectrumPlotDimensions = {
  width: 100,
  height: 100,
  padding: DEFAULT_SPECTRUM_PLOT_PADDING,
};

function countMoveCommands(path: string): number {
  return (path.match(/M/g) ?? []).length;
}

describe("buildSpectrumLinePathFromValues gap segmentation", () => {
  it("draws one continuous segment when all bands are contiguous", () => {
    const positions = [1, 2, 3, 4];
    const values = [10, 20, 30, 40];
    const runs = listContiguousBandRuns(positions);
    const path = buildSpectrumLinePathFromValues(
      positions,
      values,
      runs,
      computeSpectrumPlotXRange(positions),
      computeSpectrumPlotValueRange([values]),
      DIMENSIONS,
    );
    expect(countMoveCommands(path)).toBe(1);
  });

  it("breaks the line into two segments when a middle band is removed", () => {
    const positions = [1, 2, 5, 6];
    const values = [10, 20, 50, 60];
    const runs = listContiguousBandRuns(positions);
    const path = buildSpectrumLinePathFromValues(
      positions,
      values,
      runs,
      computeSpectrumPlotXRange(positions),
      computeSpectrumPlotValueRange([values]),
      DIMENSIONS,
    );
    expect(countMoveCommands(path)).toBe(2);
  });

  it("does not break for leading removed bands", () => {
    const positions = [3, 4, 5];
    const values = [30, 40, 50];
    const runs = listContiguousBandRuns(positions);
    const path = buildSpectrumLinePathFromValues(
      positions,
      values,
      runs,
      computeSpectrumPlotXRange(positions),
      computeSpectrumPlotValueRange([values]),
      DIMENSIONS,
    );
    expect(countMoveCommands(path)).toBe(1);
  });
});

describe("buildSpectrumStandardDeviationBandPath gap segmentation", () => {
  it("produces one closed ribbon polygon per contiguous run", () => {
    const positions = [1, 2, 5, 6];
    const means = [10, 20, 50, 60];
    const stddevs = [1, 1, 1, 1];
    const runs = listContiguousBandRuns(positions);
    const path = buildSpectrumStandardDeviationBandPath(
      positions,
      means,
      stddevs,
      runs,
      computeSpectrumPlotXRange(positions),
      computeSpectrumPlotValueRange([means]),
      DIMENSIONS,
    );
    expect((path.match(/Z/g) ?? []).length).toBe(2);
  });
});

describe("resolveXTickLabelAnchor (CT-351)", () => {
  it("centres a lone tick on its mark", () => {
    expect(resolveXTickLabelAnchor(0, 1)).toBe("middle");
  });

  it("ends the last of several ticks at its mark so the label stays inside the plot", () => {
    expect(resolveXTickLabelAnchor(4, 5)).toBe("end");
  });

  it("centres the first and inner ticks", () => {
    expect(resolveXTickLabelAnchor(0, 5)).toBe("middle");
    expect(resolveXTickLabelAnchor(2, 5)).toBe("middle");
  });
});
