import { concatenateByteArrays } from "@/lib/bytes/concatenate-byte-arrays";
import { computeCrc32OfParts } from "@/lib/bytes/crc32";
import { compressBytesToZlibBytes } from "@/lib/compression/zlib-web-streams";

// CT-338: shared PNG writing primitives - the signature, chunk/CRC framing,
// scanline-filter-byte insertion and zlib compression - used by every
// renderer-side 8-bit grayscale PNG encoder (masks, saved-image grayscale
// export). Keeping them here means those encoders differ only in what values
// they hand in, and their output stays byte-identical to before this split.

export const PNG_SIGNATURE: Uint8Array = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const IHDR_CHUNK_DATA_BYTE_LENGTH = 13;
const PNG_BIT_DEPTH_EIGHT = 8;
const PNG_COLOR_TYPE_GRAYSCALE = 0;

export function buildPngChunkBytes(chunkType: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(chunkType, (character) => character.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, computeCrc32OfParts([typeBytes, data]));
  return chunk;
}

export function buildGrayscaleEightBitIhdrChunkData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(IHDR_CHUNK_DATA_BYTE_LENGTH);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = PNG_BIT_DEPTH_EIGHT;
  data[9] = PNG_COLOR_TYPE_GRAYSCALE;
  return data;
}

export function insertNoneFilterScanlineBytes(width: number, values: Uint8Array): Uint8Array {
  const rowCount = values.length / width;
  const filtered = new Uint8Array(values.length + rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    filtered[row * (width + 1)] = 0;
    filtered.set(values.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);
  }
  return filtered;
}

export function assertPixelValuesCoverDescribedSize(
  width: number,
  height: number,
  values: Uint8Array,
  errorMessage: string,
): void {
  if (width <= 0 || height <= 0 || values.length !== width * height) {
    throw new Error(errorMessage);
  }
}

export async function assembleGrayscaleEightBitPngBytes(
  width: number,
  height: number,
  values: Uint8Array,
): Promise<Uint8Array> {
  const compressed = await compressBytesToZlibBytes(insertNoneFilterScanlineBytes(width, values));
  return concatenateByteArrays([
    PNG_SIGNATURE,
    buildPngChunkBytes("IHDR", buildGrayscaleEightBitIhdrChunkData(width, height)),
    buildPngChunkBytes("IDAT", compressed),
    buildPngChunkBytes("IEND", new Uint8Array(0)),
  ]);
}
