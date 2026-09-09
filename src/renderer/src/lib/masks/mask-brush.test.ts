import { describe, expect, it } from "vitest";

import {
  clampMaskBrushSizePx,
  clampSelectedMaskCategoryIndex,
  DEFAULT_MASK_BRUSH_SETTINGS,
  DEFAULT_MASK_BRUSH_SIZE_PX,
  listPixelIndexesUnderBrushSegment,
  listPixelIndexesUnderBrushStamp,
  maskBrushGhostFootprintDiameterPx,
  MAX_MASK_BRUSH_SIZE_PX,
  MIN_MASK_BRUSH_SIZE_PX,
  resolveArmedBrushCategoryGroupValue,
  resolveMaskBrushPaintValue,
  writeMaskValueAtPixelIndexes,
} from "@/lib/masks/mask-brush";

const TEN_BY_TEN = { width: 10, height: 10 };

function sortedIndexes(indexes: ReadonlyArray<number>): ReadonlyArray<number> {
  return [...indexes].sort((first, second) => first - second);
}

describe("mask brush settings", () => {
  it("defaults to the first category, no eraser, and an 8 image-pixel brush", () => {
    expect(DEFAULT_MASK_BRUSH_SETTINGS).toEqual({
      selectedCategoryIndex: 1,
      isEraserEnabled: false,
      brushSizePx: DEFAULT_MASK_BRUSH_SIZE_PX,
    });
    expect(DEFAULT_MASK_BRUSH_SIZE_PX).toBe(8);
  });

  it("clamps the brush size to the 1 to 64 image-pixel range", () => {
    expect(clampMaskBrushSizePx(0)).toBe(MIN_MASK_BRUSH_SIZE_PX);
    expect(clampMaskBrushSizePx(-4)).toBe(MIN_MASK_BRUSH_SIZE_PX);
    expect(clampMaskBrushSizePx(1000)).toBe(MAX_MASK_BRUSH_SIZE_PX);
    expect(clampMaskBrushSizePx(12.4)).toBe(12);
    expect(clampMaskBrushSizePx(Number.NaN)).toBe(DEFAULT_MASK_BRUSH_SIZE_PX);
  });

  it("clamps the selected category to the categories the layer has", () => {
    expect(clampSelectedMaskCategoryIndex(4, 2)).toBe(2);
    expect(clampSelectedMaskCategoryIndex(0, 2)).toBe(1);
    expect(clampSelectedMaskCategoryIndex(3, 5)).toBe(3);
    expect(clampSelectedMaskCategoryIndex(2, 0)).toBe(1);
  });

  it("paints the selected category, or unlabeled while the eraser is on", () => {
    const settings = { selectedCategoryIndex: 2, isEraserEnabled: false, brushSizePx: 8 };
    expect(resolveMaskBrushPaintValue(settings, 3)).toBe(2);
    expect(resolveMaskBrushPaintValue({ ...settings, isEraserEnabled: true }, 3)).toBe(0);
  });

  it("shows no category pressed while the eraser is on, so re-clicking it re-arms painting", () => {
    const settings = { selectedCategoryIndex: 2, isEraserEnabled: true, brushSizePx: 8 };
    expect(resolveArmedBrushCategoryGroupValue(settings)).toBe("");
  });

  it("shows the selected category pressed while the eraser is off", () => {
    const settings = { selectedCategoryIndex: 2, isEraserEnabled: false, brushSizePx: 8 };
    expect(resolveArmedBrushCategoryGroupValue(settings)).toBe("2");
  });
});

describe("listPixelIndexesUnderBrushStamp", () => {
  it("covers exactly the centre pixel at size 1", () => {
    const indexes = listPixelIndexesUnderBrushStamp({ x: 4, y: 3 }, 1, TEN_BY_TEN);
    expect(indexes).toEqual([3 * 10 + 4]);
  });

  it("covers a disc whose width grows with the brush size", () => {
    const indexes = listPixelIndexesUnderBrushStamp({ x: 5, y: 5 }, 4, TEN_BY_TEN);
    const columnsOnCentreRow = indexes
      .filter((index) => Math.floor(index / 10) === 5)
      .map((index) => index % 10);
    expect(sortedIndexes(columnsOnCentreRow)).toEqual([3, 4, 5, 6, 7]);
    expect(indexes).toHaveLength(13);
  });

  it("is round, not square: the corners of the bounding box are excluded", () => {
    const indexes = listPixelIndexesUnderBrushStamp({ x: 5, y: 5 }, 4, TEN_BY_TEN);
    expect(indexes).not.toContain(3 * 10 + 3);
    expect(indexes).toContain(3 * 10 + 5);
  });

  it("clips the stamp to the mask grid instead of wrapping", () => {
    const indexes = listPixelIndexesUnderBrushStamp({ x: 0, y: 0 }, 4, TEN_BY_TEN);
    expect(indexes.every((index) => index >= 0 && index < 100)).toBe(true);
    expect(indexes.every((index) => index % 10 <= 2)).toBe(true);
  });
});

describe("listPixelIndexesUnderBrushSegment", () => {
  it("fills the gap between two pointer samples", () => {
    const segment = { from: { x: 1, y: 4 }, to: { x: 6, y: 4 } };
    const indexes = listPixelIndexesUnderBrushSegment(segment, 1, TEN_BY_TEN);
    expect(sortedIndexes(indexes)).toEqual([41, 42, 43, 44, 45, 46]);
  });

  it("walks a diagonal segment without leaving holes", () => {
    const segment = { from: { x: 0, y: 0 }, to: { x: 3, y: 3 } };
    const indexes = listPixelIndexesUnderBrushSegment(segment, 1, TEN_BY_TEN);
    expect(sortedIndexes(indexes)).toEqual([0, 11, 22, 33]);
  });

  it("reports each pixel once when the stamps overlap", () => {
    const segment = { from: { x: 4, y: 4 }, to: { x: 5, y: 4 } };
    const indexes = listPixelIndexesUnderBrushSegment(segment, 4, TEN_BY_TEN);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("stamps once when the pointer did not move", () => {
    const segment = { from: { x: 2, y: 2 }, to: { x: 2, y: 2 } };
    expect(listPixelIndexesUnderBrushSegment(segment, 1, TEN_BY_TEN)).toEqual([22]);
  });
});

describe("writeMaskValueAtPixelIndexes", () => {
  it("writes the value at the listed pixels and leaves the rest alone", () => {
    const values = new Uint8Array(9);
    writeMaskValueAtPixelIndexes(values, [1, 4], 2);
    expect(Array.from(values)).toEqual([0, 2, 0, 0, 2, 0, 0, 0, 0]);
  });

  it("erases back to unlabeled", () => {
    const values = new Uint8Array([1, 1, 1]);
    writeMaskValueAtPixelIndexes(values, [0, 2], 0);
    expect(Array.from(values)).toEqual([0, 1, 0]);
  });

  it("ignores indexes outside the values", () => {
    const values = new Uint8Array(4);
    writeMaskValueAtPixelIndexes(values, [-1, 9], 3);
    expect(Array.from(values)).toEqual([0, 0, 0, 0]);
  });
});

describe("maskBrushGhostFootprintDiameterPx", () => {
  it("covers exactly the brush size for an odd size", () => {
    expect(maskBrushGhostFootprintDiameterPx(1)).toBe(1);
    expect(maskBrushGhostFootprintDiameterPx(3)).toBe(3);
  });

  it("covers one extra pixel for an even size, matching the stamp", () => {
    expect(maskBrushGhostFootprintDiameterPx(8)).toBe(9);
    expect(maskBrushGhostFootprintDiameterPx(2)).toBe(3);
  });

  it("matches the widest row the stamp actually paints", () => {
    for (const size of [1, 2, 3, 4, 8, 15, 64]) {
      const grid = { width: 200, height: 200 };
      const indexes = listPixelIndexesUnderBrushStamp({ x: 100, y: 100 }, size, grid);
      const columns = indexes.map((index) => index % grid.width);
      const widest = Math.max(...columns) - Math.min(...columns) + 1;
      expect(maskBrushGhostFootprintDiameterPx(size)).toBe(widest);
    }
  });

  it("clamps like the brush itself", () => {
    expect(maskBrushGhostFootprintDiameterPx(0)).toBe(MIN_MASK_BRUSH_SIZE_PX);
    expect(maskBrushGhostFootprintDiameterPx(999)).toBe(MAX_MASK_BRUSH_SIZE_PX + 1);
  });
});
