import { describe, expect, it } from "vitest";

import {
  describeRopBestProjectionReadout,
  describeRopCandidateSeedReadout,
  formatRopKeptHistoryLabel,
  formatRopProjectionBandLabel,
  formatRopScoreToSignificantFigures,
  formatRopScoringBusyLabel,
} from "./rop-format";

describe("formatRopScoreToSignificantFigures", () => {
  it("keeps four significant figures with trailing zeros, like NPC", () => {
    expect(formatRopScoreToSignificantFigures(1)).toBe("1.000");
    expect(formatRopScoreToSignificantFigures(0.25)).toBe("0.2500");
    expect(formatRopScoreToSignificantFigures(-4.56789)).toBe("-4.568");
  });
});

describe("formatRopKeptHistoryLabel", () => {
  it("names the seed alone for an unscored keep", () => {
    expect(
      formatRopKeptHistoryLabel({ seed: 20260822, objectiveLabel: null, score: null }),
    ).toBe("ROP (seed 20260822)");
  });

  it("names the seed, objective, and score for a scored keep", () => {
    expect(
      formatRopKeptHistoryLabel({ seed: 7, objectiveLabel: "CNR", score: -4 }),
    ).toBe("ROP (seed 7, CNR: -4.000)");
  });

  it("treats a score without an objective label as unscored", () => {
    expect(formatRopKeptHistoryLabel({ seed: 7, objectiveLabel: null, score: 1 })).toBe(
      "ROP (seed 7)",
    );
  });
});

describe("formatRopKeptHistoryLabel for a search winner (CT-310)", () => {
  it("names the number of projections searched, the objective, and the best score", () => {
    expect(
      formatRopKeptHistoryLabel({
        seed: 20260822,
        objectiveLabel: "CNR",
        score: 10.733,
        searchedProjectionCount: 50,
      }),
    ).toBe("ROP search (50 projections, CNR: 10.73)");
  });

  it("names a custom objective by its file name", () => {
    expect(
      formatRopKeptHistoryLabel({
        seed: 1,
        objectiveLabel: "objective.py",
        score: 200.5863,
        searchedProjectionCount: 10000,
      }),
    ).toBe("ROP search (10000 projections, objective.py: 200.6)");
  });

  // The seed drew the whole sequence, not the winning candidate, so it would be
  // a lie in a search entry even when the winner ended up unscored.
  it("never claims a seed for an unscored winner", () => {
    expect(
      formatRopKeptHistoryLabel({
        seed: 9,
        objectiveLabel: null,
        score: null,
        searchedProjectionCount: 50,
      }),
    ).toBe("ROP search (50 projections)");
  });
});

// CT-337: one press can draw several projections into one stack, and Keep best
// can freeze a single band of that batch.
describe("formatRopKeptHistoryLabel for a batch press (CT-337)", () => {
  it("names how many projections the stack holds", () => {
    expect(
      formatRopKeptHistoryLabel({
        seed: 20260822,
        objectiveLabel: null,
        score: null,
        projectionCount: 3,
      }),
    ).toBe("ROP (seed 20260822, 3 projections)");
  });

  it("names which projection of the batch a single kept band is", () => {
    expect(
      formatRopKeptHistoryLabel({
        seed: 20260822,
        objectiveLabel: "CNR",
        score: 1.5,
        projectionCount: 3,
        projectionIndex: 2,
      }),
    ).toBe("ROP (seed 20260822, projection 2 of 3, CNR: 1.500)");
  });

  it("reads exactly as it always did for a one-projection press", () => {
    expect(
      formatRopKeptHistoryLabel({
        seed: 7,
        objectiveLabel: "CNR",
        score: -4,
        projectionCount: 1,
        projectionIndex: 1,
      }),
    ).toBe("ROP (seed 7, CNR: -4.000)");
  });
});

describe("the ROP readouts (CT-337)", () => {
  it("names the batch size in the candidate readout only when there is one", () => {
    expect(describeRopCandidateSeedReadout(7, 1)).toBe("Seed 7");
    expect(describeRopCandidateSeedReadout(7, 3)).toBe("Seed 7, 3 projections");
  });

  it("names which projection the best is, only when the press drew several", () => {
    expect(describeRopBestProjectionReadout(7, 1, 1)).toBe("seed 7");
    expect(describeRopBestProjectionReadout(7, 2, 3)).toBe("seed 7, projection 2");
  });

  it("names each band of a batch and each scoring step", () => {
    expect(formatRopProjectionBandLabel(2)).toBe("Projection 2");
    expect(formatRopScoringBusyLabel(2, 3)).toBe("Scoring projection 2 of 3");
  });
});
