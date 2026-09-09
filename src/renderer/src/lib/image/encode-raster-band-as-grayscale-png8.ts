import { buildAsViewedRgbaBytesFromRaster } from "@/lib/image/as-viewed-display-mapping";
import type { ViewportDisplayMappingState } from "@/lib/image/as-viewed-display-mapping";
import { encodeGrayscaleValuesAsPng8Bytes } from "@/lib/image/encode-grayscale-png8";
import type { RasterImage } from "@/lib/image/raster-image";

// CT-339: a single-band raster (not colorInterpretation "rgb") saves as a
// one-channel grayscale PNG rather than an RGB file with three identical
// channels. The values are the R channel of the same as-viewed RGBA the
// canvas path would have drawn, so the saved image looks identical to
// before and only the channel layout changes.
export async function encodeRasterBandAsGrayscalePng8Bytes(
  raster: RasterImage,
  selectedBandIndex: number,
  displayMapping: ViewportDisplayMappingState,
): Promise<Uint8Array> {
  const rgba = buildAsViewedRgbaBytesFromRaster(raster, selectedBandIndex, displayMapping);
  const values = extractRedChannelFromRgbaBytes(rgba, raster.width, raster.height);
  return encodeGrayscaleValuesAsPng8Bytes(raster.width, raster.height, values);
}

function extractRedChannelFromRgbaBytes(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const values = new Uint8Array(width * height);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    values[pixel] = rgba[pixel * 4]!;
  }
  return values;
}
