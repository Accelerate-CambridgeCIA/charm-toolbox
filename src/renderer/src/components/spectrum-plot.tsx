import { type CSSProperties, type PointerEvent as ReactPointerEvent, useState } from "react";
import {
  buildSpectrumLinePathFromValues,
  buildSpectrumStandardDeviationBandPath,
  computeSpectrumPlotValueRange,
  computeSpectrumPlotXRange,
  DEFAULT_SPECTRUM_PLOT_PADDING,
  projectXPositionToPixelX,
  projectYValueToPixelY,
  resolveXTickLabelAnchor,
  type SpectrumPlotDimensions,
  type SpectrumTickLabelAnchor,
  type SpectrumPlotValueRange,
  type SpectrumPlotXRange,
} from "@/lib/image/spectrum-plot-geometry";
import { formatNumberStringWithSuperscriptExponent } from "@/lib/image/format-axis-number";
import type { BandRun } from "@/lib/image/spectrum-band-gaps";
import {
  findNearestBandIndexForPointerX,
  resolveNearestSpectrumLineAtBand,
  type SpectrumLineValueHit,
} from "@/lib/image/spectrum-plot-hit-test";
import {
  formatSpectrumHoverBandLabel,
  formatSpectrumHoverValueLabel,
  type SpectrumBandTooltipDescriptor,
} from "@/lib/image/spectrum-hover-tooltip";
import type { RasterSampleFormat } from "@/lib/image/raster-image";

const SPECTRUM_PLOT_WIDTH_PX = 268;
const SPECTRUM_PLOT_HEIGHT_PX = 160;
const DEFAULT_SPECTRUM_PLOT_ARIA_LABEL = "Spectra plot";

export interface SpectrumLinePlotInput {
  readonly id: string;
  readonly colorClass: string;
  readonly values: ReadonlyArray<number>;
  readonly bandStandardDeviations?: ReadonlyArray<number>;
  readonly strokeDasharray?: string;
}

// An aside that plots something other than a spectrum (CT-319's per-band NPC,
// CT-320's CNR) reuses this chart by naming it, fixing its y range, and giving
// the hover its own band labels and value formatting.
export interface SpectrumPlotHoverLabelOverrides {
  readonly bandLabels: ReadonlyArray<string>;
  readonly formatValue: (value: number) => string;
}

export interface SpectrumPlotProps {
  readonly bandPositions: ReadonlyArray<number>;
  readonly bandRuns: ReadonlyArray<BandRun>;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
  readonly xAxisLabel: string;
  readonly yAxisLabel: string;
  readonly lines: ReadonlyArray<SpectrumLinePlotInput>;
  readonly sampleFormat?: RasterSampleFormat;
  readonly bandTooltipDescriptors?: ReadonlyArray<SpectrumBandTooltipDescriptor>;
  readonly ariaLabel?: string;
  readonly fixedValueRange?: SpectrumPlotValueRange;
  readonly hoverLabelOverrides?: SpectrumPlotHoverLabelOverrides;
}

interface SpectrumPlotGeometry {
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly valueRange: SpectrumPlotValueRange;
}

export function SpectrumPlot(props: SpectrumPlotProps): JSX.Element {
  const geometry = buildSpectrumPlotGeometry(props);
  return (
    <figure className="flex flex-col gap-1">
      <SpectrumPlotInteractiveArea plot={props} geometry={geometry} />
      <SpectrumPlotAxisLabels xAxisLabel={props.xAxisLabel} yAxisLabel={props.yAxisLabel} />
    </figure>
  );
}

function buildSpectrumPlotGeometry(props: SpectrumPlotProps): SpectrumPlotGeometry {
  return {
    dimensions: buildSpectrumPlotDimensions(),
    xRange: computeSpectrumPlotXRange(props.bandPositions),
    valueRange: resolveSpectrumPlotValueRange(props),
  };
}

function resolveSpectrumPlotValueRange(props: SpectrumPlotProps): SpectrumPlotValueRange {
  if (props.fixedValueRange) return props.fixedValueRange;
  return computeSpectrumPlotValueRange(extractAllValueListsFromLines(props.lines));
}

interface PlotPointerPosition {
  readonly cssX: number;
  readonly cssY: number;
  readonly viewBoxX: number;
  readonly viewBoxY: number;
  readonly containerWidth: number;
}

interface SpectrumHoverReadout {
  readonly bandIndex: number;
  readonly bandPixelX: number;
  readonly lineHit: SpectrumLineValueHit | null;
  readonly valuePixelY: number | null;
}

interface SpectrumPlotInteractiveAreaProps {
  readonly plot: SpectrumPlotProps;
  readonly geometry: SpectrumPlotGeometry;
}

function SpectrumPlotInteractiveArea(props: SpectrumPlotInteractiveAreaProps): JSX.Element {
  const [pointer, setPointer] = useState<PlotPointerPosition | null>(null);
  const readout = pointer ? computeSpectrumHoverReadoutOrNull(props.plot, props.geometry, pointer) : null;
  return (
    <div className="relative">
      <SpectrumPlotSvg
        dimensions={props.geometry.dimensions}
        xRange={props.geometry.xRange}
        valueRange={props.geometry.valueRange}
        bandPositions={props.plot.bandPositions}
        bandRuns={props.plot.bandRuns}
        tickPositions={props.plot.tickPositions}
        tickLabels={props.plot.tickLabels}
        lines={props.plot.lines}
        ariaLabel={props.plot.ariaLabel ?? DEFAULT_SPECTRUM_PLOT_ARIA_LABEL}
        readout={readout}
        onPointerMove={(event) => setPointer(readPointerPositionInPlot(event, props.geometry.dimensions))}
        onPointerLeave={() => setPointer(null)}
      />
      {pointer && readout && (
        <SpectrumHoverTooltip pointer={pointer} readout={readout} plot={props.plot} />
      )}
    </div>
  );
}

function computeSpectrumHoverReadoutOrNull(
  plot: SpectrumPlotProps,
  geometry: SpectrumPlotGeometry,
  pointer: PlotPointerPosition,
): SpectrumHoverReadout | null {
  const bandIndex = findNearestBandIndexForPointerX(pointer.viewBoxX, plot.bandPositions, geometry.xRange, geometry.dimensions);
  if (bandIndex === null) return null;
  const bandPixelX = projectXPositionToPixelX(plot.bandPositions[bandIndex] ?? 0, geometry.xRange, geometry.dimensions);
  const lineHit = resolveNearestSpectrumLineAtBand(plot.lines, bandIndex, pointer.viewBoxY, geometry.valueRange, geometry.dimensions);
  const valuePixelY = lineHit ? projectYValueToPixelY(lineHit.value, geometry.valueRange, geometry.dimensions) : null;
  return { bandIndex, bandPixelX, lineHit, valuePixelY };
}

function readPointerPositionInPlot(
  event: ReactPointerEvent<SVGSVGElement>,
  dimensions: SpectrumPlotDimensions,
): PlotPointerPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const cssX = event.clientX - rect.left;
  const cssY = event.clientY - rect.top;
  const viewBoxX = rect.width === 0 ? 0 : (cssX / rect.width) * dimensions.width;
  const viewBoxY = rect.height === 0 ? 0 : (cssY / rect.height) * dimensions.height;
  return { cssX, cssY, viewBoxX, viewBoxY, containerWidth: rect.width };
}

function buildSpectrumPlotDimensions(): SpectrumPlotDimensions {
  return {
    width: SPECTRUM_PLOT_WIDTH_PX,
    height: SPECTRUM_PLOT_HEIGHT_PX,
    padding: DEFAULT_SPECTRUM_PLOT_PADDING,
  };
}

function extractAllValueListsFromLines(
  lines: ReadonlyArray<SpectrumLinePlotInput>,
): ReadonlyArray<ReadonlyArray<number>> {
  const lists: number[][] = [];
  for (const line of lines) {
    lists.push([...line.values]);
    if (line.bandStandardDeviations) {
      lists.push(buildRibbonValueList(line.values, line.bandStandardDeviations, 1));
      lists.push(buildRibbonValueList(line.values, line.bandStandardDeviations, -1));
    }
  }
  return lists;
}

function buildRibbonValueList(
  values: ReadonlyArray<number>,
  stddevs: ReadonlyArray<number>,
  multiplier: 1 | -1,
): number[] {
  const list: number[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const stddev = stddevs[index] ?? 0;
    if (value === undefined || !Number.isFinite(value)) continue;
    list.push(value + multiplier * stddev);
  }
  return list;
}

interface SpectrumPlotSvgProps {
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly valueRange: SpectrumPlotValueRange;
  readonly bandPositions: ReadonlyArray<number>;
  readonly bandRuns: ReadonlyArray<BandRun>;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<SpectrumLinePlotInput>;
  readonly ariaLabel: string;
  readonly readout: SpectrumHoverReadout | null;
  readonly onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly onPointerLeave: () => void;
}

function SpectrumPlotSvg(props: SpectrumPlotSvgProps): JSX.Element {
  const viewBox = `0 0 ${props.dimensions.width} ${props.dimensions.height}`;
  return (
    <svg
      role="img"
      aria-label={props.ariaLabel}
      viewBox={viewBox}
      className="h-[160px] w-full text-foreground"
      onPointerMove={props.onPointerMove}
      onPointerLeave={props.onPointerLeave}
    >
      <SpectrumPlotAxes
        dimensions={props.dimensions}
        valueRange={props.valueRange}
        xRange={props.xRange}
        tickPositions={props.tickPositions}
        tickLabels={props.tickLabels}
      />
      {props.lines.map((line) => (
        <SpectrumPlotLineGroup
          key={line.id}
          line={line}
          bandPositions={props.bandPositions}
          bandRuns={props.bandRuns}
          xRange={props.xRange}
          valueRange={props.valueRange}
          dimensions={props.dimensions}
        />
      ))}
      {props.readout && <SpectrumPlotHoverMarker readout={props.readout} dimensions={props.dimensions} />}
    </svg>
  );
}

interface SpectrumPlotHoverMarkerProps {
  readonly readout: SpectrumHoverReadout;
  readonly dimensions: SpectrumPlotDimensions;
}

function SpectrumPlotHoverMarker(props: SpectrumPlotHoverMarkerProps): JSX.Element {
  const innerTop = props.dimensions.padding.top;
  const innerBottom = props.dimensions.height - props.dimensions.padding.bottom;
  return (
    <g pointerEvents="none" className="text-primary">
      <line
        x1={props.readout.bandPixelX}
        x2={props.readout.bandPixelX}
        y1={innerTop}
        y2={innerBottom}
        className="stroke-current"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      {props.readout.valuePixelY !== null && (
        <circle
          cx={props.readout.bandPixelX}
          cy={props.readout.valuePixelY}
          r={3}
          className="fill-current stroke-background"
          strokeWidth={1}
        />
      )}
    </g>
  );
}

interface SpectrumPlotAxesProps {
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly valueRange: SpectrumPlotValueRange;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
}

function SpectrumPlotAxes(props: SpectrumPlotAxesProps): JSX.Element {
  const innerLeft = props.dimensions.padding.left;
  const innerRight = props.dimensions.width - props.dimensions.padding.right;
  const innerTop = props.dimensions.padding.top;
  const innerBottom = props.dimensions.height - props.dimensions.padding.bottom;
  return (
    <g>
      <line
        x1={innerLeft}
        x2={innerRight}
        y1={innerBottom}
        y2={innerBottom}
        className="stroke-border"
        strokeWidth={1}
      />
      <line
        x1={innerLeft}
        x2={innerLeft}
        y1={innerTop}
        y2={innerBottom}
        className="stroke-border"
        strokeWidth={1}
      />
      <SpectrumPlotXTicks
        dimensions={props.dimensions}
        xRange={props.xRange}
        tickPositions={props.tickPositions}
        tickLabels={props.tickLabels}
        innerBottom={innerBottom}
      />
      <SpectrumPlotYTicks
        dimensions={props.dimensions}
        valueRange={props.valueRange}
        innerLeft={innerLeft}
      />
    </g>
  );
}

interface SpectrumPlotXTicksProps {
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
  readonly innerBottom: number;
}

function SpectrumPlotXTicks(props: SpectrumPlotXTicksProps): JSX.Element {
  return (
    <g className="text-[10px] text-muted-foreground">
      {props.tickPositions.map((tick, index) => (
        <SpectrumPlotXTick
          key={index}
          tick={tick}
          label={props.tickLabels[index] ?? ""}
          anchor={resolveXTickLabelAnchor(index, props.tickPositions.length)}
          dimensions={props.dimensions}
          xRange={props.xRange}
          innerBottom={props.innerBottom}
        />
      ))}
    </g>
  );
}

interface SpectrumPlotXTickProps {
  readonly tick: number;
  readonly label: string;
  readonly anchor: SpectrumTickLabelAnchor;
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly innerBottom: number;
}

function SpectrumPlotXTick(props: SpectrumPlotXTickProps): JSX.Element {
  const x = projectXPositionToPixelX(props.tick, props.xRange, props.dimensions);
  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={props.innerBottom}
        y2={props.innerBottom + 3}
        className="stroke-border"
        strokeWidth={1}
      />
      <text
        x={x}
        y={props.innerBottom + 14}
        textAnchor={props.anchor}
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {props.label}
      </text>
    </g>
  );
}

interface SpectrumPlotYTicksProps {
  readonly dimensions: SpectrumPlotDimensions;
  readonly valueRange: SpectrumPlotValueRange;
  readonly innerLeft: number;
}

function SpectrumPlotYTicks(props: SpectrumPlotYTicksProps): JSX.Element {
  const ticks = [props.valueRange.minValue, props.valueRange.maxValue];
  return (
    <g className="text-[10px] text-muted-foreground">
      {ticks.map((tick, index) => (
        <SpectrumPlotYTick
          key={index}
          tick={tick}
          dimensions={props.dimensions}
          valueRange={props.valueRange}
          innerLeft={props.innerLeft}
        />
      ))}
    </g>
  );
}

interface SpectrumPlotYTickProps {
  readonly tick: number;
  readonly dimensions: SpectrumPlotDimensions;
  readonly valueRange: SpectrumPlotValueRange;
  readonly innerLeft: number;
}

function SpectrumPlotYTick(props: SpectrumPlotYTickProps): JSX.Element {
  const y = projectYValueToPixelY(props.tick, props.valueRange, props.dimensions);
  return (
    <g>
      <line
        x1={props.innerLeft - 3}
        x2={props.innerLeft}
        y1={y}
        y2={y}
        className="stroke-border"
        strokeWidth={1}
      />
      <text
        x={props.innerLeft - 5}
        y={y + 3}
        textAnchor="end"
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {formatYAxisTickLabel(props.tick)}
      </text>
    </g>
  );
}

function formatYAxisTickLabel(value: number): string {
  return formatNumberStringWithSuperscriptExponent(formatYAxisTickMagnitude(value));
}

function formatYAxisTickMagnitude(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toPrecision(3);
  if (Number.isInteger(value)) return value.toString();
  return value.toPrecision(3);
}

interface SpectrumPlotLineGroupProps {
  readonly line: SpectrumLinePlotInput;
  readonly bandPositions: ReadonlyArray<number>;
  readonly bandRuns: ReadonlyArray<BandRun>;
  readonly xRange: SpectrumPlotXRange;
  readonly valueRange: SpectrumPlotValueRange;
  readonly dimensions: SpectrumPlotDimensions;
}

function SpectrumPlotLineGroup(props: SpectrumPlotLineGroupProps): JSX.Element {
  const linePath = buildSpectrumLinePathFromValues(
    props.bandPositions,
    props.line.values,
    props.bandRuns,
    props.xRange,
    props.valueRange,
    props.dimensions,
  );
  const ribbonPath = buildOptionalRibbonPath(props);
  return (
    <g>
      {ribbonPath && (
        <path d={ribbonPath} className={`fill-current opacity-20 ${props.line.colorClass}`} />
      )}
      <path
        d={linePath}
        fill="none"
        strokeWidth={1.5}
        strokeDasharray={props.line.strokeDasharray}
        className={`stroke-current ${props.line.colorClass}`}
      />
    </g>
  );
}

function buildOptionalRibbonPath(props: SpectrumPlotLineGroupProps): string | null {
  if (!props.line.bandStandardDeviations) return null;
  return buildSpectrumStandardDeviationBandPath(
    props.bandPositions,
    props.line.values,
    props.line.bandStandardDeviations,
    props.bandRuns,
    props.xRange,
    props.valueRange,
    props.dimensions,
  );
}

interface SpectrumHoverTooltipProps {
  readonly pointer: PlotPointerPosition;
  readonly readout: SpectrumHoverReadout;
  readonly plot: SpectrumPlotProps;
}

function SpectrumHoverTooltip(props: SpectrumHoverTooltipProps): JSX.Element {
  const bandLabel = describeHoverBandLabel(props.plot, props.readout.bandIndex);
  const valueLabel = describeHoverValueLabel(props.plot, props.readout.lineHit);
  return (
    <div
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
      style={buildHoverTooltipPositionStyle(props.pointer)}
    >
      <div className="font-medium">{bandLabel}</div>
      {valueLabel && <div className="font-mono text-muted-foreground">{valueLabel}</div>}
    </div>
  );
}

function buildHoverTooltipPositionStyle(pointer: PlotPointerPosition): CSSProperties {
  const top = pointer.cssY + 8;
  if (pointer.cssX > pointer.containerWidth / 2) {
    return { right: pointer.containerWidth - pointer.cssX + 8, top };
  }
  return { left: pointer.cssX + 8, top };
}

function describeHoverBandLabel(plot: SpectrumPlotProps, bandIndex: number): string {
  const overriddenLabel = plot.hoverLabelOverrides?.bandLabels[bandIndex];
  if (overriddenLabel) return overriddenLabel;
  const descriptor = plot.bandTooltipDescriptors?.[bandIndex];
  if (descriptor) return formatSpectrumHoverBandLabel(descriptor);
  return `Band ${bandIndex + 1}`;
}

function describeHoverValueLabel(
  plot: SpectrumPlotProps,
  lineHit: SpectrumLineValueHit | null,
): string | null {
  if (lineHit === null) return null;
  const formatOverriddenValue = plot.hoverLabelOverrides?.formatValue;
  if (formatOverriddenValue) return formatOverriddenValue(lineHit.value);
  return formatSpectrumHoverValueLabel(lineHit, plot.sampleFormat ?? "uint");
}

interface SpectrumPlotAxisLabelsProps {
  readonly xAxisLabel: string;
  readonly yAxisLabel: string;
}

function SpectrumPlotAxisLabels(props: SpectrumPlotAxisLabelsProps): JSX.Element {
  return (
    <figcaption className="flex items-center justify-between text-[10px] text-muted-foreground">
      <span>{props.yAxisLabel}</span>
      <span>{props.xAxisLabel}</span>
    </figcaption>
  );
}
