import { describe, expect, it } from "vitest";

import {
  formatNpcHistoryAppliedLabel,
  formatNpcScoreToSignificantFigures,
} from "./npc-score-format";
import type { PerBandScoreRow } from "./per-band-score-presentation";

describe("formatNpcScoreToSignificantFigures", () => {
  it("keeps four significant figures, trailing zeros included", () => {
    expect(formatNpcScoreToSignificantFigures(0.9999999999999991)).toBe("1.000");
    expect(formatNpcScoreToSignificantFigures(0.25)).toBe("0.2500");
    expect(formatNpcScoreToSignificantFigures(0)).toBe("0.000");
  });

  it("rounds rather than truncates", () => {
    expect(formatNpcScoreToSignificantFigures(0.123456)).toBe("0.1235");
  });

  it("shows a dash rather than NaN when there is no usable score", () => {
    expect(formatNpcScoreToSignificantFigures(Number.NaN)).toBe("-");
    expect(formatNpcScoreToSignificantFigures(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

function buildTopBandRows(scores: ReadonlyArray<number>): PerBandScoreRow[] {
  return scores.map((score, bandIndex) => ({
    bandIndex,
    bandIdentityText: `Band ${bandIndex + 1}`,
    score,
  }));
}

describe("formatNpcHistoryAppliedLabel", () => {
  it("records the mask layer, the bin count, and the single band it scored", () => {
    expect(
      formatNpcHistoryAppliedLabel("Parchment mask", 255, buildTopBandRows([0.9999999999999991])),
    ).toBe("Potential Contrast (Parchment mask, 255 bins): Band 1 1.000");
  });

  it("names every top row in list order", () => {
    expect(formatNpcHistoryAppliedLabel("Parchment mask", 2, buildTopBandRows([1, 0.5, 0.25]))).toBe(
      "Potential Contrast (Parchment mask, 2 bins): Band 1 1.000, Band 2 0.5000, Band 3 0.2500",
    );
  });

  it("names all five rows when the top list is full", () => {
    const label = formatNpcHistoryAppliedLabel(
      "Parchment mask",
      255,
      buildTopBandRows([0.9, 0.8, 0.7, 0.6, 0.5]),
    );
    expect(label).toBe(
      "Potential Contrast (Parchment mask, 255 bins): Band 1 0.9000, Band 2 0.8000, Band 3 0.7000, Band 4 0.6000, Band 5 0.5000",
    );
  });
});
