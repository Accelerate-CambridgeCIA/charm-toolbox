// CT-309: the ROP panel's flat-memory candidate model. The panel only ever
// holds TWO candidates - the one on screen and the best-scoring one since the
// panel opened - so pressing "New projection" ten thousand times costs the same
// memory as pressing it once.
//
// CT-337: one press can draw SEVERAL projections, so a candidate is a batch of
// bands with one score each (a single press is a one-element batch) and the
// retained best names one BAND of one batch.

export interface RopCandidate {
  readonly seed: number;
  readonly bands: ReadonlyArray<Float32Array>;
  readonly scores: ReadonlyArray<number | null>;
  // CT-310: set when this candidate WON a search of that many projections,
  // which is what its History entry says instead of a seed nobody could
  // re-roll into this band.
  readonly searchedProjectionCount?: number | null;
}

// The best is a band, not a whole batch: only one projection of a press can be
// the best-scoring one the panel offers to keep.
export interface RopBestProjection {
  readonly candidate: RopCandidate;
  readonly bandIndex: number;
  readonly score: number;
}

// An unscored candidate (objective "None", or a scoring run that was stopped)
// never becomes the best: "best" is defined by the objective's score alone.
// A tie keeps the previous best, so the earliest press wins.
export function retainBestScoringRopCandidate(
  best: RopBestProjection | null,
  next: RopCandidate,
): RopBestProjection | null {
  const contender = findBestScoringProjectionOrNull(next);
  if (contender === null) return best;
  if (best !== null && best.score >= contender.score) return best;
  return contender;
}

// Within one batch a tie keeps the earlier band, for the same reason.
export function findBestScoringProjectionOrNull(
  candidate: RopCandidate,
): RopBestProjection | null {
  let best: RopBestProjection | null = null;
  for (let bandIndex = 0; bandIndex < candidate.scores.length; bandIndex += 1) {
    best = preferHigherScoringProjection(best, candidate, bandIndex);
  }
  return best;
}

function preferHigherScoringProjection(
  best: RopBestProjection | null,
  candidate: RopCandidate,
  bandIndex: number,
): RopBestProjection | null {
  const score = candidate.scores[bandIndex] ?? null;
  if (score === null || !Number.isFinite(score)) return best;
  if (best !== null && best.score >= score) return best;
  return { candidate, bandIndex, score };
}

// Switching objectives makes previous scores incomparable: the retained best
// resets and the on-screen candidate keeps its preview but drops its scores.
export function dropScoresAfterObjectiveChange(
  current: RopCandidate | null,
): RopCandidate | null {
  if (current === null || current.scores.every((score) => score === null)) return current;
  return { ...current, scores: current.scores.map(() => null) };
}

// The per-band score plot reads plain numbers; an unscored band is not
// comparable, which is exactly what a non-finite value means there.
export function mapRopScoresToPlotValues(
  scores: ReadonlyArray<number | null>,
): ReadonlyArray<number> {
  return scores.map((score) => score ?? Number.NaN);
}
