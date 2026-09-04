import { describe, expect, it } from "vitest";

import { encodeGrayscaleValuesAsPng8Bytes } from "@/lib/image/encode-grayscale-png8";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";

describe("encodeGrayscaleValuesAsPng8Bytes", () => {
  it("round-trips a 3x2 grayscale image through the mask PNG decoder", async () => {
    const values = Uint8Array.from([10, 20, 30, 40, 50, 60]);
    const encoded = await encodeGrayscaleValuesAsPng8Bytes(3, 2, values);
    const decoded = await decodeMaskPngBytes(encoded);
    expect(decoded).toEqual({ width: 3, height: 2, values });
  });

  it("writes an 8-bit, colour type 0 IHDR", async () => {
    const encoded = await encodeGrayscaleValuesAsPng8Bytes(2, 2, new Uint8Array(4));
    expect(encoded[24]).toBe(8);
    expect(encoded[25]).toBe(0);
  });

  it("refuses values that do not cover the described size", async () => {
    await expect(
      encodeGrayscaleValuesAsPng8Bytes(4, 4, new Uint8Array(9)),
    ).rejects.toThrow("The image does not cover the described size.");
  });
});
