import { DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE } from "@/lib/image/as-viewed-display-mapping";
import { describe, expect, it } from "vitest";

import {
  planPngStackExportUpload,
  requireScientificMultiBandRasterForPngStack,
  type PngStackFileUploadPlan,
} from "@/lib/image/plan-png-stack-export";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-273: the folder export plans one PNG file per band. The 16-bit variant
// streams raw big-endian samples (MAIN encodes); the 8-bit variant encodes
// each band eagerly through the injected band encoder.

const TINY_CHUNK_BYTES = 5;

function buildTwoBandRaster(): RasterImage {
  return {
    width: 3,
    height: 2,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    sourceInterleave: "bsq",
    bandPixels: [
      new Uint16Array([10, 20, 30, 40, 50, 60]),
      new Uint16Array([110, 120, 130, 140, 150, 160]),
    ],
  };
}

function asSource(raster: RasterImage): ViewportImageSource {
  return { kind: "raster", raster };
}

async function collectPlanBytes(plan: PngStackFileUploadPlan): Promise<Uint8Array> {
  const collected: number[] = [];
  await plan.plan.emitChunksInOrder(TINY_CHUNK_BYTES, async (chunk) => {
    collected.push(...chunk);
  });
  return Uint8Array.from(collected);
}

describe("planPngStackExportUpload", () => {
  it("plans one raw big-endian sample stream per band for the 16-bit variant", async () => {
    const files = await planPngStackExportUpload({
      source: asSource(buildTwoBandRaster()),
      originalFileName: "cube.tif",
      formatId: "png-stack-16-bit",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    });
    expect(files.map((file) => file.fileName)).toEqual(["cube_band_001.png", "cube_band_002.png"]);
    for (const file of files) {
      expect(file.plan.byteLength).toBe(12);
      expect(file.encoding).toEqual({ kind: "png-16-bit-grayscale", width: 3, height: 2 });
    }
    expect(await collectPlanBytes(files[0]!)).toEqual(
      Uint8Array.from([0, 10, 0, 20, 0, 30, 0, 40, 0, 50, 0, 60]),
    );
    expect(await collectPlanBytes(files[1]!)).toEqual(
      Uint8Array.from([0, 110, 0, 120, 0, 130, 0, 140, 0, 150, 0, 160]),
    );
  });

  it("encodes each band through the band encoder for the 8-bit variant, reporting per-band progress", async () => {
    const encodedBands = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6, 7])];
    const encodedIndexes: number[] = [];
    const fractions: number[] = [];
    const files = await planPngStackExportUpload({
      source: asSource(buildTwoBandRaster()),
      originalFileName: "cube.tif",
      formatId: "png-stack-8-bit",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
      onProgress: (fraction) => fractions.push(fraction),
      encodeBandAsPng8Bytes: async (_raster, bandIndex) => {
        encodedIndexes.push(bandIndex);
        return encodedBands[bandIndex]!;
      },
    });
    expect(encodedIndexes).toEqual([0, 1]);
    expect(fractions).toEqual([0.5, 1]);
    expect(files.map((file) => file.plan.byteLength)).toEqual([3, 4]);
    expect(files.every((file) => file.encoding === undefined)).toBe(true);
    expect(await collectPlanBytes(files[0]!)).toEqual(encodedBands[0]);
    expect(await collectPlanBytes(files[1]!)).toEqual(encodedBands[1]);
  });
});

// CT-339: without an injected encoder, the 8-bit stack export writes each
// band as a one-channel grayscale PNG (not an RGB canvas file).
describe("planPngStackExportUpload default 8-bit band encoder", () => {
  it("writes each band as a one-channel grayscale PNG", async () => {
    const raster: RasterImage = {
      width: 2,
      height: 1,
      bandCount: 2,
      bitsPerSample: 8,
      sampleFormat: "uint",
      bandPixels: [new Uint8Array([0, 255]), new Uint8Array([10, 20])],
    };
    const files = await planPngStackExportUpload({
      source: asSource(raster),
      originalFileName: "cube.tif",
      formatId: "png-stack-8-bit",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    });
    const decodedFirst = await decodeMaskPngBytes(await collectPlanBytes(files[0]!));
    const decodedSecond = await decodeMaskPngBytes(await collectPlanBytes(files[1]!));
    expect(decodedFirst).toEqual({ width: 2, height: 1, values: Uint8Array.from([0, 255]) });
    expect(decodedSecond).toEqual({ width: 2, height: 1, values: Uint8Array.from([10, 20]) });
  });
});

describe("requireScientificMultiBandRasterForPngStack", () => {
  it("refuses a single-band raster", () => {
    const raster = { ...buildTwoBandRaster(), bandCount: 1, bandPixels: [new Uint16Array(6)] };
    expect(() =>
      requireScientificMultiBandRasterForPngStack(asSource(raster), "png-stack-8-bit"),
    ).toThrow(/one file per band/);
  });

  it("refuses a true-colour composite", () => {
    const raster: RasterImage = {
      ...buildTwoBandRaster(),
      bandCount: 3,
      colorInterpretation: "rgb",
      bandPixels: [new Uint16Array(6), new Uint16Array(6), new Uint16Array(6)],
    };
    expect(() =>
      requireScientificMultiBandRasterForPngStack(asSource(raster), "png-stack-8-bit"),
    ).toThrow(/multi-band scientific stack/);
  });

  it("refuses a float source for the 16-bit variant with the CT-271 locked copy", () => {
    const raster: RasterImage = {
      ...buildTwoBandRaster(),
      bitsPerSample: 32,
      sampleFormat: "float",
      bandPixels: [new Float32Array(6), new Float32Array(6)],
    };
    expect(() =>
      requireScientificMultiBandRasterForPngStack(asSource(raster), "png-stack-16-bit"),
    ).toThrow("16-bit PNG stores integers. Use ENVI float for float data.");
    expect(requireScientificMultiBandRasterForPngStack(asSource(raster), "png-stack-8-bit")).toBe(
      raster,
    );
  });
});
