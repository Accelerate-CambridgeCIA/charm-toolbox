import type { BandRun } from "@/lib/image/spectrum-band-gaps";

export interface SpectrumPlotPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface SpectrumPlotDimensions {
  readonly width: number;
  readonly height: number;
  readonly padding: SpectrumPlotPadding;
}

export interface SpectrumPlotValueRange {
  readonly minValue: number;
  readonly maxValue: number;
}

export interface SpectrumPlotXRange {
  readonly minPosition: number;
  readonly maxPosition: number;
}

export const DEFAULT_SPECTRUM_PLOT_PADDING: SpectrumPlotPadding = Object.freeze({
  top: 8,
  right: 8,
  bottom: 24,
  left: 36,
});

export function computeSpectrumPlotXRange(
  bandPositions: ReadonlyArray<number>,
): SpectrumPlotXRange {
  if (bandPositions.length === 0) return { minPosition: 0, maxPosition: 1 };
  const minPosition = Math.min(...bandPositions);
  const maxPosition = Math.max(...bandPositions);
  if (minPosition === maxPosition) {
    return { minPosition: minPosition - 1, maxPosition: maxPosition + 1 };
  }
  return { minPosition, maxPosition };
}

export function computeSpectrumPlotValueRange(
  valueLists: ReadonlyArray<ReadonlyArray<number>>,
): SpectrumPlotValueRange {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const values of valueLists) {
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      if (value < minValue) minValue = value;
      if (value > maxValue) maxValue = value;
    }
  }
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return { minValue: 0, maxValue: 1 };
  if (minValue === maxValue) return { minValue: minValue - 1, maxValue: maxValue + 1 };
  return { minValue, maxValue };
}

export type SpectrumTickLabelAnchor = "middle" | "end";

// The last x tick sits padding.right from the svg edge, so a centred four-digit
// wavelength label ("1100" is about 24px at 10px monospace) spilled past the
// viewBox and was clipped (CT-351). Anchoring the last label at its end keeps
// it inside; a lone tick or an inner tick stays centred on its mark.
export function resolveXTickLabelAnchor(tickIndex: number, tickCount: number): SpectrumTickLabelAnchor {
  const isLastOfSeveral = tickCount > 1 && tickIndex === tickCount - 1;
  return isLastOfSeveral ? "end" : "middle";
}

export function projectXPositionToPixelX(
  position: number,
  xRange: SpectrumPlotXRange,
  dimensions: SpectrumPlotDimensions,
): number {
  const innerWidth = dimensions.width - dimensions.padding.left - dimensions.padding.right;
  if (innerWidth <= 0) return dimensions.padding.left;
  const span = xRange.maxPosition - xRange.minPosition;
  if (span === 0) return dimensions.padding.left;
  const fraction = (position - xRange.minPosition) / span;
  return dimensions.padding.left + fraction * innerWidth;
}

export function projectYValueToPixelY(
  value: number,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): number {
  const innerHeight = dimensions.height - dimensions.padding.top - dimensions.padding.bottom;
  if (innerHeight <= 0) return dimensions.padding.top;
  const span = valueRange.maxValue - valueRange.minValue;
  if (span === 0) return dimensions.padding.top + innerHeight / 2;
  const fraction = (value - valueRange.minValue) / span;
  return dimensions.padding.top + (1 - fraction) * innerHeight;
}

export function buildSpectrumLinePathFromValues(
  bandPositions: ReadonlyArray<number>,
  values: ReadonlyArray<number>,
  bandRuns: ReadonlyArray<BandRun>,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): string {
  return bandRuns
    .map((run) =>
      buildLinePathForBandRun(run, bandPositions, values, xRange, valueRange, dimensions),
    )
    .filter((segment) => segment.length > 0)
    .join(" ");
}

function buildLinePathForBandRun(
  run: BandRun,
  bandPositions: ReadonlyArray<number>,
  values: ReadonlyArray<number>,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): string {
  const segments: string[] = [];
  for (let index = run.startIndex; index < run.endIndexExclusive; index++) {
    const point = projectBandValuePointOrNull(index, bandPositions, values, xRange, valueRange, dimensions);
    if (point === null) continue;
    segments.push(`${segments.length === 0 ? "M" : "L"}${point}`);
  }
  return segments.join(" ");
}

function projectBandValuePointOrNull(
  index: number,
  bandPositions: ReadonlyArray<number>,
  values: ReadonlyArray<number>,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): string | null {
  const value = values[index];
  const position = bandPositions[index];
  if (value === undefined || position === undefined || !Number.isFinite(value)) return null;
  const x = projectXPositionToPixelX(position, xRange, dimensions);
  const y = projectYValueToPixelY(value, valueRange, dimensions);
  return `${formatCoordinate(x)} ${formatCoordinate(y)}`;
}

export function buildSpectrumStandardDeviationBandPath(
  bandPositions: ReadonlyArray<number>,
  bandMeans: ReadonlyArray<number>,
  bandStandardDeviations: ReadonlyArray<number>,
  bandRuns: ReadonlyArray<BandRun>,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): string {
  return bandRuns
    .map((run) =>
      buildRibbonPolygonForBandRun(
        run,
        { bandPositions, bandMeans, bandStandardDeviations },
        xRange,
        valueRange,
        dimensions,
      ),
    )
    .filter((polygon) => polygon.length > 0)
    .join(" ");
}

interface BandRibbonInputs {
  readonly bandPositions: ReadonlyArray<number>;
  readonly bandMeans: ReadonlyArray<number>;
  readonly bandStandardDeviations: ReadonlyArray<number>;
}

function buildRibbonPolygonForBandRun(
  run: BandRun,
  inputs: BandRibbonInputs,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): string {
  const upper = collectBandRibbonPoints(run, inputs, 1, xRange, valueRange, dimensions);
  const lowerForward = collectBandRibbonPoints(run, inputs, -1, xRange, valueRange, dimensions);
  const lower = [...lowerForward].reverse();
  if (upper.length === 0 || lower.length === 0) return "";
  return `M${upper[0]} ${appendLineSegments(upper.slice(1))} L${lower.join(" L")} Z`;
}

function appendLineSegments(points: ReadonlyArray<string>): string {
  return points.map((point) => `L${point}`).join(" ");
}

function collectBandRibbonPoints(
  run: BandRun,
  inputs: BandRibbonInputs,
  multiplier: 1 | -1,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): ReadonlyArray<string> {
  const points: string[] = [];
  for (let index = run.startIndex; index < run.endIndexExclusive; index++) {
    const point = projectBandRibbonPointOrNull(index, inputs, multiplier, xRange, valueRange, dimensions);
    if (point !== null) points.push(point);
  }
  return points;
}

function projectBandRibbonPointOrNull(
  index: number,
  inputs: BandRibbonInputs,
  multiplier: 1 | -1,
  xRange: SpectrumPlotXRange,
  valueRange: SpectrumPlotValueRange,
  dimensions: SpectrumPlotDimensions,
): string | null {
  const mean = inputs.bandMeans[index];
  const position = inputs.bandPositions[index];
  if (mean === undefined || position === undefined || !Number.isFinite(mean)) return null;
  const ribbonValue = mean + multiplier * (inputs.bandStandardDeviations[index] ?? 0);
  const x = projectXPositionToPixelX(position, xRange, dimensions);
  const y = projectYValueToPixelY(ribbonValue, valueRange, dimensions);
  return `${formatCoordinate(x)} ${formatCoordinate(y)}`;
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}
