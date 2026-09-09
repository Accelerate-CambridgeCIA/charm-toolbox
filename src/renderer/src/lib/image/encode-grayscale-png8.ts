import {
  assembleGrayscaleEightBitPngBytes,
  assertPixelValuesCoverDescribedSize,
} from "@/lib/image/png-chunk-writer";

// CT-338: a pure 8-bit, colour type 0, non-interlaced grayscale PNG encoder
// for single-band saved images, built on the same shared framing the mask
// codec uses (lib/image/png-chunk-writer.ts) so a grayscale export and a mask
// export are byte-for-byte the same PNG shape.

const IMAGE_SIZE_MISMATCH_MESSAGE = "The image does not cover the described size.";

export async function encodeGrayscaleValuesAsPng8Bytes(
  width: number,
  height: number,
  values: Uint8Array,
): Promise<Uint8Array> {
  assertPixelValuesCoverDescribedSize(width, height, values, IMAGE_SIZE_MISMATCH_MESSAGE);
  return assembleGrayscaleEightBitPngBytes(width, height, values);
}
