import {
  assembleGrayscaleEightBitPngBytes,
  assertPixelValuesCoverDescribedSize,
} from "@/lib/image/png-chunk-writer";

// CT-303: a mask layer exports as an 8-bit GRAYSCALE PNG whose pixel values
// ARE the category indexes (0 = unlabeled, 1..5 = the category's position), so
// the file drops straight into numpy/PIL without a palette lookup. Every
// scanline uses filter type 0 (None): the payload is tiny and unfiltered rows
// keep the exported bytes trivially readable by any decoder. The chunk/CRC,
// scanline-filter and zlib pieces live in the shared CT-338 png-chunk-writer.

const MASK_SIZE_MISMATCH_MESSAGE = "The mask does not cover the described size.";

export async function encodeMaskValuesAsGrayscalePngBytes(
  width: number,
  height: number,
  values: Uint8Array,
): Promise<Uint8Array> {
  assertPixelValuesCoverDescribedSize(width, height, values, MASK_SIZE_MISMATCH_MESSAGE);
  return assembleGrayscaleEightBitPngBytes(width, height, values);
}
