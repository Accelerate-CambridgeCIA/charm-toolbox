import { MAX_MASK_CATEGORY_COUNT, UNLABELED_MASK_VALUE } from "@/lib/masks/mask-layer";

// CT-304: the freehand brush, as pure grid arithmetic. Everything here works in
// IMAGE pixels (the mask's own grid), so the view transform never leaks in: the
// caller converts canvas points to image points first.
//
// A stamp is the disc of radius brushSizePx / 2 around the centre pixel, so an
// odd size covers exactly that many pixels across and an even size covers one
// more (size 8 spans 9 pixels). A stroke is the union of the stamps walked
// along the segment between two pointer samples, one pixel at a time, so a fast
// drag paints a continuous line instead of a dotted one.

export interface MaskBrushSettings {
  readonly selectedCategoryIndex: number;
  readonly isEraserEnabled: boolean;
  readonly brushSizePx: number;
}

export interface MaskImagePoint {
  readonly x: number;
  readonly y: number;
}

export interface MaskGridSize {
  readonly width: number;
  readonly height: number;
}

export interface MaskBrushSegment {
  readonly from: MaskImagePoint;
  readonly to: MaskImagePoint;
}

export const MIN_MASK_BRUSH_SIZE_PX = 1;
export const MAX_MASK_BRUSH_SIZE_PX = 64;
export const DEFAULT_MASK_BRUSH_SIZE_PX = 8;
export const FIRST_MASK_CATEGORY_INDEX = 1;

export const DEFAULT_MASK_BRUSH_SETTINGS: MaskBrushSettings = Object.freeze({
  selectedCategoryIndex: FIRST_MASK_CATEGORY_INDEX,
  isEraserEnabled: false,
  brushSizePx: DEFAULT_MASK_BRUSH_SIZE_PX,
});

export function clampMaskBrushSizePx(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return DEFAULT_MASK_BRUSH_SIZE_PX;
  return Math.min(MAX_MASK_BRUSH_SIZE_PX, Math.max(MIN_MASK_BRUSH_SIZE_PX, Math.round(sizePx)));
}

export function clampSelectedMaskCategoryIndex(index: number, categoryCount: number): number {
  const highestIndex = Math.max(
    FIRST_MASK_CATEGORY_INDEX,
    Math.min(categoryCount, MAX_MASK_CATEGORY_COUNT),
  );
  if (!Number.isFinite(index)) return FIRST_MASK_CATEGORY_INDEX;
  return Math.min(highestIndex, Math.max(FIRST_MASK_CATEGORY_INDEX, Math.round(index)));
}

// The eraser paints "unlabeled"; anything else paints the selected category,
// clamped to the categories the layer actually has.
export function resolveMaskBrushPaintValue(
  settings: MaskBrushSettings,
  categoryCount: number,
): number {
  if (settings.isEraserEnabled) return UNLABELED_MASK_VALUE;
  return clampSelectedMaskCategoryIndex(settings.selectedCategoryIndex, categoryCount);
}

// While the eraser is on, no category should show pressed: otherwise Radix
// treats the still-pressed category as already selected, so clicking it again
// to re-arm painting emits "" (its own toggle-off) instead of the category
// value, and selectBrushCategoryWhenChosen's "" guard swallows it.
export function resolveArmedBrushCategoryGroupValue(settings: MaskBrushSettings): string {
  if (settings.isEraserEnabled) return "";
  return String(settings.selectedCategoryIndex);
}

// The width in IMAGE pixels a stamp covers across its centre row: an odd size
// covers exactly that many pixels, an even size covers one more (size 8 spans
// 9). The hover ghost draws a circle of this diameter so the user sees the
// exact footprint a click would paint.
export function maskBrushGhostFootprintDiameterPx(brushSizePx: number): number {
  const size = clampMaskBrushSizePx(brushSizePx);
  return size % 2 === 0 ? size + 1 : size;
}

export function listPixelIndexesUnderBrushStamp(
  center: MaskImagePoint,
  brushSizePx: number,
  grid: MaskGridSize,
): ReadonlyArray<number> {
  const radius = clampMaskBrushSizePx(brushSizePx) / 2;
  const indexes: number[] = [];
  for (const row of listGridRowsWithinRadius(center.y, radius, grid.height)) {
    appendRowPixelIndexesWithinRadius(indexes, row, center, radius, grid);
  }
  return indexes;
}

function listGridRowsWithinRadius(
  centerY: number,
  radius: number,
  height: number,
): ReadonlyArray<number> {
  const firstRow = Math.max(0, Math.ceil(centerY - radius));
  const lastRow = Math.min(height - 1, Math.floor(centerY + radius));
  const rows: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) rows.push(row);
  return rows;
}

function appendRowPixelIndexesWithinRadius(
  indexes: number[],
  row: number,
  center: MaskImagePoint,
  radius: number,
  grid: MaskGridSize,
): void {
  const halfSpan = computeRowHalfSpanWithinRadius(row - center.y, radius);
  const firstColumn = Math.max(0, Math.ceil(center.x - halfSpan));
  const lastColumn = Math.min(grid.width - 1, Math.floor(center.x + halfSpan));
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    indexes.push(row * grid.width + column);
  }
}

function computeRowHalfSpanWithinRadius(rowDistance: number, radius: number): number {
  return Math.sqrt(Math.max(0, radius * radius - rowDistance * rowDistance));
}

export function listPixelIndexesUnderBrushSegment(
  segment: MaskBrushSegment,
  brushSizePx: number,
  grid: MaskGridSize,
): ReadonlyArray<number> {
  const indexes = new Set<number>();
  for (const point of listPointsWalkedAlongSegment(segment)) {
    for (const index of listPixelIndexesUnderBrushStamp(point, brushSizePx, grid)) {
      indexes.add(index);
    }
  }
  return [...indexes];
}

function listPointsWalkedAlongSegment(segment: MaskBrushSegment): ReadonlyArray<MaskImagePoint> {
  const stepCount = countStepsToWalkSegmentOnePixelAtATime(segment);
  if (stepCount === 0) return [segment.from];
  return Array.from({ length: stepCount + 1 }, (_, step) =>
    interpolatePointAlongSegment(segment, step / stepCount),
  );
}

function countStepsToWalkSegmentOnePixelAtATime(segment: MaskBrushSegment): number {
  const horizontalSpan = Math.abs(segment.to.x - segment.from.x);
  const verticalSpan = Math.abs(segment.to.y - segment.from.y);
  return Math.ceil(Math.max(horizontalSpan, verticalSpan));
}

function interpolatePointAlongSegment(
  segment: MaskBrushSegment,
  fraction: number,
): MaskImagePoint {
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * fraction,
    y: segment.from.y + (segment.to.y - segment.from.y) * fraction,
  };
}

// MUTATES the given values. A stroke owns a private working copy of the layer's
// values (allocated once at pointer-down and committed to state at pointer-up),
// so painting a 2000 x 2000 mask does not allocate a fresh cube per pointer
// event. Never hand this a Uint8Array that other code is already reading.
export function writeMaskValueAtPixelIndexes(
  values: Uint8Array,
  pixelIndexes: ReadonlyArray<number>,
  value: number,
): void {
  for (const index of pixelIndexes) {
    if (index >= 0 && index < values.length) values[index] = value;
  }
}
