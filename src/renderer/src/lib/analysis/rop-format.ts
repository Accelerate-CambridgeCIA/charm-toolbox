import { formatNpcScoreToSignificantFigures } from "./npc-score-format";

// CT-309: display and History formatting for the ROP panel. Scores share the
// NPC convention (four significant figures, trailing zeros kept) so every
// Stage 6 analysis reads the same way.

export function formatRopScoreToSignificantFigures(score: number): string {
  return formatNpcScoreToSignificantFigures(score);
}

export interface RopKeptLabelInputs {
  readonly seed: number;
  readonly objectiveLabel: string | null;
  readonly score: number | null;
  // CT-310: set when the candidate WON a search rather than being a single
  // press, so a kept winner is never labelled as a seed anyone could re-roll.
  readonly searchedProjectionCount?: number | null;
  // CT-337: how many projections the press drew, and which one of them this
  // stack holds when only a single band was kept.
  readonly projectionCount?: number | null;
  readonly projectionIndex?: number | null;
}

// "ROP (seed 20260822)" unscored; "ROP (seed 20260822, CNR: 1.234)" scored;
// "ROP (seed 20260822, 3 projections)" for a whole batch; "ROP (seed 20260822,
// projection 2 of 3, CNR: 1.234)" for one band of a batch; "ROP search
// (50 projections, CNR: 1.234)" for a search winner.
export function formatRopKeptHistoryLabel(inputs: RopKeptLabelInputs): string {
  const searched = describeSearchedProjectionsOrNull(inputs);
  if (searched !== null) return searched;
  return `ROP (${joinLabelParts([describeSeedAndProjections(inputs), describeObjectiveScoreOrNull(inputs)])})`;
}

// A search winner is never described by its seed: the seed drew the whole
// sequence, not the winning candidate, so re-rolling it would not reproduce
// this stack. An unscored winner (its scoring run was stopped) simply says how
// many projections were searched.
function describeSearchedProjectionsOrNull(inputs: RopKeptLabelInputs): string | null {
  const count = inputs.searchedProjectionCount ?? null;
  if (count === null) return null;
  const parts = [`${count} projections`, describeObjectiveScoreOrNull(inputs)];
  return `ROP search (${joinLabelParts(parts)})`;
}

function describeSeedAndProjections(inputs: RopKeptLabelInputs): string {
  const count = inputs.projectionCount ?? 1;
  const index = inputs.projectionIndex ?? null;
  if (count < 2) return `seed ${inputs.seed}`;
  if (index === null) return `seed ${inputs.seed}, ${count} projections`;
  return `seed ${inputs.seed}, projection ${index} of ${count}`;
}

function describeObjectiveScoreOrNull(inputs: RopKeptLabelInputs): string | null {
  if (inputs.objectiveLabel === null || inputs.score === null) return null;
  return `${inputs.objectiveLabel}: ${formatRopScoreToSignificantFigures(inputs.score)}`;
}

function joinLabelParts(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(", ");
}

// CT-337: the aside's readouts and band names for a batch. A one-projection
// press reads exactly as it did before the batch existed.
export function describeRopCandidateSeedReadout(
  seed: number,
  projectionCount: number,
): string {
  if (projectionCount < 2) return `Seed ${seed}`;
  return `Seed ${seed}, ${projectionCount} projections`;
}

export function describeRopBestProjectionReadout(
  seed: number,
  projectionNumber: number,
  projectionCount: number,
): string {
  if (projectionCount < 2) return `seed ${seed}`;
  return `seed ${seed}, projection ${projectionNumber}`;
}

export function formatRopProjectionBandLabel(projectionNumber: number): string {
  return `Projection ${projectionNumber}`;
}

export function formatRopScoringBusyLabel(
  projectionNumber: number,
  projectionCount: number,
): string {
  return `Scoring projection ${projectionNumber} of ${projectionCount}`;
}
