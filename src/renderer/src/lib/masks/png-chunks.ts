// CT-303: PNG chunk reading for the renderer-side mask codec. A PNG file is
// its 8-byte signature followed by length-prefixed, CRC-checked chunks; the
// decoder walks them here. The IHDR fields themselves are parsed by the
// shared sniffing module so both processes read the header the same way. The
// WRITER side (signature, chunk/CRC framing) moved to the CT-338 shared
// lib/image/png-chunk-writer.ts.

export const PNG_SIGNATURE_BYTE_LENGTH = 8;

export interface PngChunk {
  readonly chunkType: string;
  readonly data: Uint8Array;
}

export function listPngChunksAfterSignature(fileBytes: Uint8Array): ReadonlyArray<PngChunk> {
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE_BYTE_LENGTH;
  while (offset + 12 <= fileBytes.byteLength) {
    const dataLength = readBigEndianUint32At(fileBytes, offset);
    chunks.push(readChunkAtOffset(fileBytes, offset, dataLength));
    offset += 12 + dataLength;
  }
  return chunks;
}

function readChunkAtOffset(
  fileBytes: Uint8Array,
  offset: number,
  dataLength: number,
): PngChunk {
  return {
    chunkType: String.fromCharCode(...fileBytes.subarray(offset + 4, offset + 8)),
    data: fileBytes.subarray(offset + 8, offset + 8 + dataLength),
  };
}

function readBigEndianUint32At(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset);
}
