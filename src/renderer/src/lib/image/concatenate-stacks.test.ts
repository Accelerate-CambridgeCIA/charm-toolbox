import { describe, expect, it } from "vitest";

import { listRasterBandOriginalNumbers, type RasterImage } from "@/lib/image/raster-image";
import { concatenateRasterStacks, widenSampleType } from "./concatenate-stacks";

function buildRaster(options: {
  width: number;
  height: number;
  bandCount: number;
  sampleFormat: RasterImage["sampleFormat"];
  bitsPerSample: number;
  fillValue: number;
  bandLabels?: ReadonlyArray<string>;
  bandWavelengths?: ReadonlyArray<number>;
  bandOriginalNumbers?: ReadonlyArray<number>;
}): RasterImage {
  const length = options.width * options.height;
  const bandPixels = Array.from({ length: options.bandCount }, () =>
    new Uint16Array(length).fill(options.fillValue),
  );
  return {
    bandPixels,
    width: options.width,
    height: options.height,
    bitsPerSample: options.bitsPerSample,
    sampleFormat: options.sampleFormat,
    bandCount: options.bandCount,
    bandLabels: options.bandLabels,
    bandWavelengths: options.bandWavelengths,
    bandOriginalNumbers: options.bandOriginalNumbers,
  };
}

describe("widenSampleType", () => {
  it("keeps the type unchanged when both sides match exactly", () => {
    expect(widenSampleType({ sampleFormat: "uint", bitsPerSample: 16 }, { sampleFormat: "uint", bitsPerSample: 16 })).toEqual({
      sampleFormat: "uint",
      bitsPerSample: 16,
    });
  });

  it("widens uint8 + uint16 to uint16", () => {
    expect(widenSampleType({ sampleFormat: "uint", bitsPerSample: 8 }, { sampleFormat: "uint", bitsPerSample: 16 })).toEqual({
      sampleFormat: "uint",
      bitsPerSample: 16,
    });
  });

  it("widens any int + float to float32", () => {
    expect(widenSampleType({ sampleFormat: "int", bitsPerSample: 16 }, { sampleFormat: "float", bitsPerSample: 32 })).toEqual({
      sampleFormat: "float",
      bitsPerSample: 32,
    });
    expect(widenSampleType({ sampleFormat: "uint", bitsPerSample: 8 }, { sampleFormat: "float", bitsPerSample: 64 })).toEqual({
      sampleFormat: "float",
      bitsPerSample: 32,
    });
  });

  it("widens two floats to the larger float width", () => {
    expect(widenSampleType({ sampleFormat: "float", bitsPerSample: 32 }, { sampleFormat: "float", bitsPerSample: 64 })).toEqual({
      sampleFormat: "float",
      bitsPerSample: 64,
    });
  });

  it("widens mixed signed/unsigned ints to a signed container that fits both", () => {
    expect(widenSampleType({ sampleFormat: "uint", bitsPerSample: 16 }, { sampleFormat: "int", bitsPerSample: 8 })).toEqual({
      sampleFormat: "int",
      bitsPerSample: 32,
    });
  });
});

describe("concatenateRasterStacks", () => {
  it("orders result bands as active bands first, then second stack's bands", () => {
    const active = buildRaster({ width: 2, height: 2, bandCount: 2, sampleFormat: "uint", bitsPerSample: 16, fillValue: 10 });
    const second = buildRaster({ width: 2, height: 2, bandCount: 1, sampleFormat: "uint", bitsPerSample: 16, fillValue: 20 });
    const result = concatenateRasterStacks(active, second);
    expect(result.bandCount).toBe(3);
    expect(result.bandPixels[0]?.[0]).toBe(10);
    expect(result.bandPixels[1]?.[0]).toBe(10);
    expect(result.bandPixels[2]?.[0]).toBe(20);
  });

  it("widens sample format/bit depth to the common type without rescaling values", () => {
    const active = buildRaster({ width: 2, height: 2, bandCount: 1, sampleFormat: "uint", bitsPerSample: 8, fillValue: 200 });
    const second = buildRaster({ width: 2, height: 2, bandCount: 1, sampleFormat: "uint", bitsPerSample: 16, fillValue: 5000 });
    const result = concatenateRasterStacks(active, second);
    expect(result.sampleFormat).toBe("uint");
    expect(result.bitsPerSample).toBe(16);
    expect(result.bandPixels[0]).toBeInstanceOf(Uint16Array);
    expect(result.bandPixels[0]?.[0]).toBe(200);
    expect(result.bandPixels[1]?.[0]).toBe(5000);
  });

  it("carries per-band labels and wavelengths through from each source where present, and renumbers sequentially", () => {
    const active = buildRaster({
      width: 2,
      height: 2,
      bandCount: 1,
      sampleFormat: "uint",
      bitsPerSample: 16,
      fillValue: 1,
      bandLabels: ["UV"],
      bandWavelengths: [365],
      bandOriginalNumbers: [1],
    });
    const second = buildRaster({
      width: 2,
      height: 2,
      bandCount: 1,
      sampleFormat: "uint",
      bitsPerSample: 16,
      fillValue: 2,
      bandLabels: ["IR"],
      bandWavelengths: [850],
      bandOriginalNumbers: [1],
    });
    const result = concatenateRasterStacks(active, second);
    expect(result.bandLabels).toEqual(["UV", "IR"]);
    expect(result.bandWavelengths).toEqual([365, 850]);
    expect(result.bandOriginalNumbers).toBeUndefined();
    expect(listRasterBandOriginalNumbers(result)).toEqual([1, 2]);
  });

  it("renumbers a 3+3 band concatenation sequentially, ignoring each source's own original numbers", () => {
    const active = buildRaster({
      width: 2,
      height: 2,
      bandCount: 3,
      sampleFormat: "uint",
      bitsPerSample: 16,
      fillValue: 1,
      bandOriginalNumbers: [1, 2, 3],
    });
    const second = buildRaster({
      width: 2,
      height: 2,
      bandCount: 3,
      sampleFormat: "uint",
      bitsPerSample: 16,
      fillValue: 2,
      bandOriginalNumbers: [1, 2, 3],
    });
    const result = concatenateRasterStacks(active, second);
    expect(result.bandOriginalNumbers).toBeUndefined();
    expect(listRasterBandOriginalNumbers(result)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.bandLabels).toEqual(["", "", "", "", "", ""]);
  });

  it("drops wavelengths entirely when either source lacks them", () => {
    const active = buildRaster({
      width: 2,
      height: 2,
      bandCount: 1,
      sampleFormat: "uint",
      bitsPerSample: 16,
      fillValue: 1,
      bandWavelengths: [365],
    });
    const second = buildRaster({ width: 2, height: 2, bandCount: 1, sampleFormat: "uint", bitsPerSample: 16, fillValue: 2 });
    const result = concatenateRasterStacks(active, second);
    expect(result.bandWavelengths).toBeUndefined();
  });

  it("throws when the second stack's dimensions do not match the active stack", () => {
    const active = buildRaster({ width: 4, height: 4, bandCount: 1, sampleFormat: "uint", bitsPerSample: 16, fillValue: 1 });
    const second = buildRaster({ width: 8, height: 8, bandCount: 1, sampleFormat: "uint", bitsPerSample: 16, fillValue: 1 });
    expect(() => concatenateRasterStacks(active, second)).toThrow(/does not match/);
  });
});
