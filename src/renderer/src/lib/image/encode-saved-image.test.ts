import { DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE } from "@/lib/image/as-viewed-display-mapping";
import { describe, expect, it, vi } from "vitest";

import {
  encodeViewportSourceForSaving,
  planViewportSourceSaveUpload,
} from "@/lib/image/encode-saved-image";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-339: the canvas encoder needs a DOM, which this vitest environment does
// not provide; mocking it lets the routing tests assert WHICH path ran
// without exercising the canvas itself.
vi.mock("@/lib/image/encode-canvas", () => ({
  encodeViewportSourceAsCanvasBlobBytes: vi.fn(async () => new Uint8Array([9, 9, 9])),
}));

// CT-219f: the save encode threads onProgress into the chunked TIFF and ENVI encoders
// so the app save busy entry renders a determinate percentage bar.
describe("encodeViewportSourceForSaving progress reporting", () => {
  it("reports monotonic 0..1 progress for a TIFF export", async () => {
    const fractions: number[] = [];
    const encoded = await encodeViewportSourceForSaving({
      source: buildRasterSource(),
      selectedBandIndex: 0,
      formatId: "tiff-16-bit",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
      onProgress: (fraction) => fractions.push(fraction),
    });
    expect(encoded.bytes.length).toBeGreaterThan(0);
    expectMonotonicFractionsEndingAtOne(fractions);
  });

  it("reports monotonic 0..1 progress for an ENVI export", async () => {
    const fractions: number[] = [];
    const encoded = await encodeViewportSourceForSaving({
      source: buildRasterSource(),
      selectedBandIndex: 0,
      formatId: "envi",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
      onProgress: (fraction) => fractions.push(fraction),
    });
    expect(encoded.sidecar?.bytes.length).toBeGreaterThan(0);
    expectMonotonicFractionsEndingAtOne(fractions);
  });

  it("reports monotonic 0..1 progress for a float ENVI export of an integer stack", async () => {
    const fractions: number[] = [];
    await encodeViewportSourceForSaving({
      source: buildRasterSource(),
      selectedBandIndex: 0,
      formatId: "envi-float",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
      onProgress: (fraction) => fractions.push(fraction),
    });
    expectMonotonicFractionsEndingAtOne(fractions);
  });
});

// CT-339: PNG (8-bit) writes a one-channel grayscale file for a single-band
// raster and keeps the RGBA canvas path for an rgb-tagged raster.
describe("encodeViewportSourceForSaving PNG (8-bit) routing", () => {
  it("routes a single-band uint8 raster through the grayscale encoder", async () => {
    const raster: RasterImage = {
      width: 2,
      height: 1,
      bandCount: 1,
      bitsPerSample: 8,
      sampleFormat: "uint",
      bandPixels: [new Uint8Array([0, 255])],
    };
    const encoded = await encodeViewportSourceForSaving({
      source: { kind: "raster", raster },
      selectedBandIndex: 0,
      formatId: "png-8-bit",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    });
    const decoded = await decodeMaskPngBytes(encoded.bytes);
    expect(decoded).toEqual({ width: 2, height: 1, values: Uint8Array.from([0, 255]) });
  });

  it("routes an rgb-tagged raster through the canvas encoder", async () => {
    const raster: RasterImage = {
      width: 1,
      height: 1,
      bandCount: 3,
      bitsPerSample: 8,
      sampleFormat: "uint",
      colorInterpretation: "rgb",
      bandPixels: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
    };
    const encoded = await encodeViewportSourceForSaving({
      source: { kind: "raster", raster },
      selectedBandIndex: 0,
      formatId: "png-8-bit",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    });
    expect(encoded.bytes).toEqual(new Uint8Array([9, 9, 9]));
  });
});

function expectMonotonicFractionsEndingAtOne(fractions: ReadonlyArray<number>): void {
  expect(fractions.length).toBeGreaterThan(0);
  const sorted = [...fractions].sort((a, b) => a - b);
  expect(fractions).toEqual(sorted);
  expect(fractions.at(-1)).toBe(1);
}

function buildRasterSource(): ViewportImageSource {
  const raster: RasterImage = {
    width: 3,
    height: 2,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandPixels: [
      new Uint16Array([10, 20, 30, 40, 50, 60]),
      new Uint16Array([110, 120, 130, 140, 150, 160]),
    ],
  };
  return { kind: "raster", raster };
}

// CT-271: the 16-bit PNG plan streams RAW big-endian samples and asks MAIN to
// encode; it is never encoded renderer-side.
describe("planViewportSourceSaveUpload for 16-bit PNG", () => {
  it("plans the raw sample payload with the main-process encoding descriptor", async () => {
    const upload = await planViewportSourceSaveUpload({
      source: buildRasterSource(),
      selectedBandIndex: 1,
      formatId: "png-16-bit",
      displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    });
    expect(upload.primary.byteLength).toBe(12);
    expect(upload.primaryEncoding).toEqual({ kind: "png-16-bit-grayscale", width: 3, height: 2 });
    expect(upload.sidecar).toBeUndefined();
  });

  it("refuses a float source with the locked ENVI-float hint (picker safety net)", async () => {
    const floatRaster: RasterImage = {
      width: 1,
      height: 1,
      bandCount: 1,
      bitsPerSample: 32,
      sampleFormat: "float",
      bandPixels: [new Float32Array([0.5])],
    };
    await expect(
      planViewportSourceSaveUpload({
        source: { kind: "raster", raster: floatRaster },
        selectedBandIndex: 0,
        formatId: "png-16-bit",
        displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
      }),
    ).rejects.toThrow("16-bit PNG stores integers. Use ENVI float for float data.");
  });

  it("refuses a true-colour composite (colour photos keep 8-bit PNG)", async () => {
    const composite: RasterImage = {
      width: 1,
      height: 1,
      bandCount: 3,
      bitsPerSample: 8,
      sampleFormat: "uint",
      colorInterpretation: "rgb",
      bandPixels: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
    };
    await expect(
      planViewportSourceSaveUpload({
        source: { kind: "raster", raster: composite },
        selectedBandIndex: 0,
        formatId: "png-16-bit",
        displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
      }),
    ).rejects.toThrow(/8-bit/);
  });

  it("is not encodable through the renderer-side whole-buffer encoder", async () => {
    await expect(
      encodeViewportSourceForSaving({
        source: buildRasterSource(),
        selectedBandIndex: 0,
        formatId: "png-16-bit",
        displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
      }),
    ).rejects.toThrow(/main process/);
  });
});
