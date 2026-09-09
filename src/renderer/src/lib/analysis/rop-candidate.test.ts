import { describe, expect, it } from "vitest";

import {
  dropScoresAfterObjectiveChange,
  findBestScoringProjectionOrNull,
  mapRopScoresToPlotValues,
  retainBestScoringRopCandidate,
  type RopBestProjection,
  type RopCandidate,
} from "./rop-candidate";

function candidate(seed: number, ...scores: ReadonlyArray<number | null>): RopCandidate {
  return {
    seed,
    bands: scores.map((_score, index) => Float32Array.from([seed, index])),
    scores,
  };
}

function bestOf(next: RopCandidate): RopBestProjection {
  const best = findBestScoringProjectionOrNull(next);
  if (best === null) throw new Error("expected a scored band");
  return best;
}

describe("retainBestScoringRopCandidate", () => {
  it("retains the first scored candidate as the best", () => {
    const next = candidate(1, 0.5);
    expect(retainBestScoringRopCandidate(null, next)).toEqual({
      candidate: next,
      bandIndex: 0,
      score: 0.5,
    });
  });

  it("replaces the best only when the new score is strictly higher", () => {
    const best = bestOf(candidate(1, 0.5));
    expect(retainBestScoringRopCandidate(best, candidate(2, 0.7))?.score).toBe(0.7);
    expect(retainBestScoringRopCandidate(best, candidate(3, 0.5))).toBe(best);
    expect(retainBestScoringRopCandidate(best, candidate(4, 0.3))).toBe(best);
  });

  it("never lets an unscored candidate become or displace the best", () => {
    const best = bestOf(candidate(1, 0.5));
    expect(retainBestScoringRopCandidate(best, candidate(2, null))).toBe(best);
    expect(retainBestScoringRopCandidate(null, candidate(2, null))).toBeNull();
  });

  // CT-337: a press can draw several projections, and only the best band of the
  // batch competes with the retained best.
  it("compares the best finite band of a batch against the retained best", () => {
    const batch = candidate(9, 0.2, 0.9, null);
    const winner = retainBestScoringRopCandidate(bestOf(candidate(1, 0.5)), batch);
    expect(winner).toEqual({ candidate: batch, bandIndex: 1, score: 0.9 });
  });

  it("keeps the previous best when the batch only ties it", () => {
    const best = bestOf(candidate(1, 0.5));
    expect(retainBestScoringRopCandidate(best, candidate(2, 0.4, 0.5))).toBe(best);
  });

  it("ignores non-finite band scores when picking the best of a batch", () => {
    const batch = candidate(3, Number.NaN, Number.POSITIVE_INFINITY, 0.1);
    expect(retainBestScoringRopCandidate(null, batch)).toEqual({
      candidate: batch,
      bandIndex: 2,
      score: 0.1,
    });
  });
});

describe("findBestScoringProjectionOrNull", () => {
  it("keeps the earlier band when two bands of one batch tie", () => {
    expect(findBestScoringProjectionOrNull(candidate(1, 0.5, 0.5))?.bandIndex).toBe(0);
  });

  it("returns null when no band of the batch is scored", () => {
    expect(findBestScoringProjectionOrNull(candidate(1, null, null))).toBeNull();
  });
});

describe("dropScoresAfterObjectiveChange", () => {
  it("keeps the candidate and its bands but clears every score", () => {
    const dropped = dropScoresAfterObjectiveChange(candidate(1, 0.5, 0.7));
    expect(dropped?.seed).toBe(1);
    expect(dropped?.bands).toHaveLength(2);
    expect(dropped?.scores).toEqual([null, null]);
  });

  it("returns unscored candidates and null unchanged by identity", () => {
    const unscored = candidate(1, null, null);
    expect(dropScoresAfterObjectiveChange(unscored)).toBe(unscored);
    expect(dropScoresAfterObjectiveChange(null)).toBeNull();
  });
});

describe("mapRopScoresToPlotValues", () => {
  it("plots an unscored band as a non-finite value the score list drops", () => {
    const values = mapRopScoresToPlotValues([0.5, null, 1.5]);
    expect(values[0]).toBe(0.5);
    expect(Number.isFinite(values[1] ?? 0)).toBe(false);
    expect(values[2]).toBe(1.5);
  });
});
