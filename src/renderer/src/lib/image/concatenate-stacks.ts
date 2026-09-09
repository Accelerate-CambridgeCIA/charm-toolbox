import { buildRasterMemoryAllocationErrorForByteLength } from "@/lib/image/raster-allocation";
import {
  getRasterBandExplicitLabelOrNull,
  type RasterImage,
  type RasterSampleFormat,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

// CT-300: concatenate the bands of two open stacks with matching spatial
// dimensions into one wider stack. Values are copied as-is (never rescaled);
// only the sample TYPE widens to a common container that can hold both
// sources' raw values.

export interface RasterTypeDescriptor {
  readonly sampleFormat: RasterSampleFormat;
  readonly bitsPerSample: number;
}

export function concatenateRasterStacks(active: RasterImage, second: RasterImage): RasterImage {
  assertConcatenationCandidateMatchesActiveDimensions(active, second);
  const widened = widenSampleType(descriptorOf(active), descriptorOf(second));
  return {
    bandPixels: buildConcatenatedBandPixels(active, second, widened),
    width: active.width,
    height: active.height,
    bitsPerSample: widened.bitsPerSample,
    sampleFormat: widened.sampleFormat,
    bandCount: active.bandCount + second.bandCount,
    bandLabels: buildConcatenatedBandLabels(active, second),
    bandWavelengths: buildConcatenatedBandWavelengths(active, second),
    // CT-341: a concatenated stack renumbers sequentially, so bands from
    // either source never collide on their original position.
    bandOriginalNumbers: undefined,
  };
}

function descriptorOf(raster: RasterImage): RasterTypeDescriptor {
  return { sampleFormat: raster.sampleFormat, bitsPerSample: raster.bitsPerSample };
}

function assertConcatenationCandidateMatchesActiveDimensions(
  active: RasterImage,
  second: RasterImage,
): void {
  if (second.width === active.width && second.height === active.height) return;
  throw new Error(
    `Second stack size (${second.width}x${second.height}) does not match the active stack size ` +
      `(${active.width}x${active.height}). Choose a stack with the same width and height.`,
  );
}

// The type-widening lattice: same type is unchanged, mixing in a float always
// widens to float32, matching integer families take the wider bit depth, and
// mixed signed/unsigned integers widen to the smallest signed container that
// can hold both value ranges.
export function widenSampleType(a: RasterTypeDescriptor, b: RasterTypeDescriptor): RasterTypeDescriptor {
  if (a.sampleFormat === b.sampleFormat && a.bitsPerSample === b.bitsPerSample) return a;
  if (a.sampleFormat === "float" || b.sampleFormat === "float") return widenWithFloat(a, b);
  if (a.sampleFormat === b.sampleFormat) {
    return { sampleFormat: a.sampleFormat, bitsPerSample: Math.max(a.bitsPerSample, b.bitsPerSample) };
  }
  return widenMixedSignedUnsignedInt(a, b);
}

function widenWithFloat(a: RasterTypeDescriptor, b: RasterTypeDescriptor): RasterTypeDescriptor {
  if (a.sampleFormat === "float" && b.sampleFormat === "float") {
    return { sampleFormat: "float", bitsPerSample: Math.max(a.bitsPerSample, b.bitsPerSample) };
  }
  return { sampleFormat: "float", bitsPerSample: 32 };
}

function widenMixedSignedUnsignedInt(a: RasterTypeDescriptor, b: RasterTypeDescriptor): RasterTypeDescriptor {
  const neededBits = Math.max(bitsNeededToRepresentAsSigned(a), bitsNeededToRepresentAsSigned(b));
  return { sampleFormat: "int", bitsPerSample: smallestSupportedIntBitsAtLeast(neededBits) };
}

function bitsNeededToRepresentAsSigned(type: RasterTypeDescriptor): number {
  return type.sampleFormat === "int" ? type.bitsPerSample : type.bitsPerSample + 1;
}

function smallestSupportedIntBitsAtLeast(bits: number): number {
  if (bits <= 8) return 8;
  if (bits <= 16) return 16;
  return 32;
}

type RasterTypedArrayConstructor = new (length: number) => RasterTypedArray;

function typedArrayConstructorForType(type: RasterTypeDescriptor): RasterTypedArrayConstructor {
  if (type.sampleFormat === "float") return type.bitsPerSample >= 64 ? Float64Array : Float32Array;
  if (type.sampleFormat === "uint") return unsignedIntConstructorForBits(type.bitsPerSample);
  return signedIntConstructorForBits(type.bitsPerSample);
}

function unsignedIntConstructorForBits(bits: number): RasterTypedArrayConstructor {
  if (bits <= 8) return Uint8Array;
  if (bits <= 16) return Uint16Array;
  return Uint32Array;
}

function signedIntConstructorForBits(bits: number): RasterTypedArrayConstructor {
  if (bits <= 8) return Int8Array;
  if (bits <= 16) return Int16Array;
  return Int32Array;
}

function buildConcatenatedBandPixels(
  active: RasterImage,
  second: RasterImage,
  widened: RasterTypeDescriptor,
): RasterTypedArray[] {
  return [
    ...active.bandPixels.map((band) => widenBandToType(band, widened)),
    ...second.bandPixels.map((band) => widenBandToType(band, widened)),
  ];
}

function widenBandToType(band: RasterTypedArray, target: RasterTypeDescriptor): RasterTypedArray {
  const Constructor = typedArrayConstructorForType(target);
  const out = allocateWidenedBandOrThrow(Constructor, band.length);
  out.set(band as never);
  return out;
}

function allocateWidenedBandOrThrow(
  Constructor: RasterTypedArrayConstructor,
  length: number,
): RasterTypedArray {
  try {
    return new Constructor(length);
  } catch {
    const bytesPerElement = (Constructor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    throw buildRasterMemoryAllocationErrorForByteLength(length * bytesPerElement);
  }
}

function buildConcatenatedBandLabels(active: RasterImage, second: RasterImage): ReadonlyArray<string> {
  return [...collectExplicitOrEmptyLabels(active), ...collectExplicitOrEmptyLabels(second)];
}

function collectExplicitOrEmptyLabels(raster: RasterImage): string[] {
  return Array.from(
    { length: raster.bandCount },
    (_, index) => getRasterBandExplicitLabelOrNull(raster, index) ?? "",
  );
}

function buildConcatenatedBandWavelengths(
  active: RasterImage,
  second: RasterImage,
): ReadonlyArray<number> | undefined {
  if (!active.bandWavelengths || !second.bandWavelengths) return undefined;
  return [...active.bandWavelengths, ...second.bandWavelengths];
}
