import {
  formatPerBandScoreRowList,
  type PerBandScoreRow,
} from "./per-band-score-presentation";

// CT-308: NPC produces scores in 0..1. The panel and the History entry show
// them to four significant figures, so trailing zeros are KEPT (toPrecision, not
// a re-parsed number): "1.000" reads as a measured score, "1" reads as a
// constant. CT-319: the entry names the top bands rather than one pooled score.

const NPC_SCORE_SIGNIFICANT_FIGURES = 4;
const UNAVAILABLE_NPC_SCORE_TEXT = "-";

export function formatNpcScoreToSignificantFigures(score: number): string {
  if (!Number.isFinite(score)) return UNAVAILABLE_NPC_SCORE_TEXT;
  return score.toPrecision(NPC_SCORE_SIGNIFICANT_FIGURES);
}

export function formatNpcHistoryAppliedLabel(
  maskLayerName: string,
  bins: number,
  topBandRows: ReadonlyArray<PerBandScoreRow>,
): string {
  const rowList = formatPerBandScoreRowList(topBandRows, formatNpcScoreToSignificantFigures);
  return `Potential Contrast (${maskLayerName}, ${bins} bins): ${rowList}`;
}
