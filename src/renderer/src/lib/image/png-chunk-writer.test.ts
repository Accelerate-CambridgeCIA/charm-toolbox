import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  buildGrayscaleEightBitIhdrChunkData,
  buildPngChunkBytes,
  insertNoneFilterScanlineBytes,
  PNG_SIGNATURE,
} from "@/lib/image/png-chunk-writer";

describe("buildPngChunkBytes", () => {
  it("frames the type and data with a big-endian length and a CRC over both", () => {
    const data = Uint8Array.from([1, 2, 3, 4]);
    const chunk = buildPngChunkBytes("IDAT", data);
    const view = new DataView(chunk.buffer);
    expect(view.getUint32(0)).toBe(data.byteLength);
    expect(String.fromCharCode(...chunk.subarray(4, 8))).toBe("IDAT");
    expect(Array.from(chunk.subarray(8, 12))).toEqual(Array.from(data));
    const typeBytes = Uint8Array.from("IDAT", (character) => character.charCodeAt(0));
    expect(view.getUint32(12)).toBe(crc32(data, crc32(typeBytes)) >>> 0);
  });

  it("agrees with an independent CRC-32 implementation for an empty chunk", () => {
    const chunk = buildPngChunkBytes("IEND", new Uint8Array(0));
    const view = new DataView(chunk.buffer);
    const typeBytes = Uint8Array.from("IEND", (character) => character.charCodeAt(0));
    expect(view.getUint32(8)).toBe(crc32(typeBytes) >>> 0);
  });
});

describe("buildGrayscaleEightBitIhdrChunkData", () => {
  it("reports 8-bit depth and grayscale colour type for the given size", () => {
    const data = buildGrayscaleEightBitIhdrChunkData(4, 3);
    const view = new DataView(data.buffer);
    expect(view.getUint32(0)).toBe(4);
    expect(view.getUint32(4)).toBe(3);
    expect(data[8]).toBe(8);
    expect(data[9]).toBe(0);
  });
});

describe("insertNoneFilterScanlineBytes", () => {
  it("prefixes every row with a filter-type-0 byte", () => {
    const values = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const filtered = insertNoneFilterScanlineBytes(3, values);
    expect(Array.from(filtered)).toEqual([0, 1, 2, 3, 0, 4, 5, 6]);
  });

  it("emits one filter byte per row for a single-column image", () => {
    const values = Uint8Array.from([7, 8]);
    const filtered = insertNoneFilterScanlineBytes(1, values);
    expect(Array.from(filtered)).toEqual([0, 7, 0, 8]);
  });
});

describe("PNG_SIGNATURE", () => {
  it("is the standard 8-byte PNG signature", () => {
    expect(Array.from(PNG_SIGNATURE)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
