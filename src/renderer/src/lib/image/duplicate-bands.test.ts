import { describe, expect, it } from "vitest";

import { listRasterBandOriginalNumbers, type RasterImage } from "@/lib/image/raster-image";
import { duplicateRasterBands } from "./duplicate-bands";

function buildRaster(options: {
  bandFillValues: ReadonlyArray<number>;
  bandLabels?: ReadonlyArray<string>;
  bandWavelengths?: ReadonlyArray<number>;
  bandOriginalNumbers?: ReadonlyArray<number>;
}): RasterImage {
  const bandPixels = options.bandFillValues.map((value) => Uint16Array.from([value, value]));
  return {
    bandPixels,
    width: 2,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: bandPixels.length,
    bandLabels: options.bandLabels,
    bandWavelengths: options.bandWavelengths,
    bandOriginalNumbers: options.bandOriginalNumbers,
  };
}

describe("duplicateRasterBands", () => {
  it("appends copies at the end of the stack in the given order", () => {
    const raster = buildRaster({ bandFillValues: [10, 20, 30] });
    const result = duplicateRasterBands(raster, [2, 0]);
    expect(result.bandCount).toBe(5);
    expect(result.bandPixels.map((band) => band[0])).toEqual([10, 20, 30, 30, 10]);
  });

  it("copies pixel data independently (mutating a duplicate does not affect the source band)", () => {
    const raster = buildRaster({ bandFillValues: [10] });
    const result = duplicateRasterBands(raster, [0]);
    result.bandPixels[1]![0] = 999;
    expect(result.bandPixels[0]?.[0]).toBe(10);
    expect(raster.bandPixels[0]?.[0]).toBe(10);
  });

  it("copies wavelength, leaves originals untouched, and renumbers the result sequentially", () => {
    const raster = buildRaster({
      bandFillValues: [10, 20],
      bandWavelengths: [400, 700],
      bandOriginalNumbers: [1, 2],
    });
    const result = duplicateRasterBands(raster, [1]);
    expect(result.bandWavelengths).toEqual([400, 700, 700]);
    expect(result.bandOriginalNumbers).toBeUndefined();
    expect(listRasterBandOriginalNumbers(result)).toEqual([1, 2, 3]);
  });

  it("renumbers a 3-band raster with band 1 duplicated as [1,2,3,4]", () => {
    const raster = buildRaster({ bandFillValues: [10, 20, 30] });
    const result = duplicateRasterBands(raster, [0]);
    expect(result.bandOriginalNumbers).toBeUndefined();
    expect(listRasterBandOriginalNumbers(result)).toEqual([1, 2, 3, 4]);
  });

  it("labels a duplicate as the source band's label plus ' copy', explicit or default", () => {
    const raster = buildRaster({ bandFillValues: [10, 20], bandLabels: ["UV", ""] });
    const result = duplicateRasterBands(raster, [0, 1]);
    expect(result.bandLabels).toEqual(["UV", "", "UV copy", "Band 2 copy"]);
  });

  it("leaves wavelengths undefined when the source raster has none", () => {
    const raster = buildRaster({ bandFillValues: [10] });
    const result = duplicateRasterBands(raster, [0]);
    expect(result.bandWavelengths).toBeUndefined();
  });

  it("throws when no bands are given to duplicate", () => {
    const raster = buildRaster({ bandFillValues: [10] });
    expect(() => duplicateRasterBands(raster, [])).toThrow(/at least one band/);
  });

  it("throws when a band index is out of range", () => {
    const raster = buildRaster({ bandFillValues: [10] });
    expect(() => duplicateRasterBands(raster, [1])).toThrow(/out of range/);
  });
});
