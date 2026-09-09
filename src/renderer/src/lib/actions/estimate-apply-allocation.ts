import { COMPONENT_COUNT_PARAMETER_ID } from "@/lib/actions/dimension-reduction-action";
import type { ParameterValuesById } from "@/lib/actions/parameter-schema";
import {
  readInvertApplyToAllBands,
  readRoiFromCropParameterValues,
  type RegisteredViewportAction,
} from "@/lib/actions/registered-actions";
import {
  CONCATENATE_STACKS_ACTION_ID,
  CONCATENATE_STACKS_SECOND_STACK_PARAMETER_ID,
} from "@/lib/actions/concatenate-stacks-action";
import {
  DUPLICATE_BANDS_ACTION_ID,
  DUPLICATE_BANDS_PARAMETER_ID_BAND_NUMBERS,
  readDuplicatedBandNumbersFromParameterValues,
} from "@/lib/actions/duplicate-bands-action";
import { LOCAL_PCA_ACTION_ID } from "@/lib/actions/local-pca-action";
import { LOCAL_MNF_ACTION_ID } from "@/lib/actions/local-mnf-action";
import { L2_MINIMIZATION_ACTION_ID } from "@/lib/actions/l2-minimization-action";
import {
  ROP_KEEP_ACTION_ID,
  ROP_PROJECTION_BAND_COUNT_PARAMETER_ID,
} from "@/lib/actions/rop-keep-action";
import { resolveComponentCount } from "@/lib/image/dimension-reduction/component-count";
import { describeFastIcaFitSampling } from "@/lib/image/dimension-reduction/ica";
import { readRasterReferenceTokenOrEmpty, NO_RASTER_REFERENCE_SELECTED } from "@/lib/actions/parameter-schema";
import { widenSampleType } from "@/lib/image/concatenate-stacks";
import { readRememberedReferenceRasterOrNull } from "@/lib/image/reference-raster-store";
import { TONE_CURVE_SCOPE_PARAMETER_ID, WHOLE_STACK_TONE_CURVE_SCOPE_VALUE } from "@/lib/actions/tone-curve-scope";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-239: how many bytes of new band arrays an apply will materialize, computed
// from dimensions and parameters alone so the memory-budget gate can refuse an
// over-budget apply BEFORE a result panel is reserved or any band allocates
// (the CT-190 preflight pattern). Estimates are per operation family:
// - float ops (normalize, standardize, percentile clip, denoise,
//   spatial filter, spectral derivative, flat-field, spectralon) always build a
//   full float32 cube - band-wise scopes too, because unchanged integer bands
//   are CONVERTED to float32, not carried by reference.
// - type-preserving whole-cube ops (bit shift, rotate, reflect, clip by
//   value, whole-stack tone curve, all-bands invert) re-allocate the
//   source's own byte count.
// - band-targeted and aliasing ops cost one band or nothing; the default for
//   unlisted actions is one float band, which never blocks.

const FLOAT32_BYTES_PER_SAMPLE = 4;
const THRESHOLD_OUTPUT_BYTES_PER_SAMPLE = 1;

const FLOAT32_FULL_CUBE_ACTION_IDS: ReadonlySet<string> = new Set([
  "normalize-data",
  "standardize",
  "percentile-clip",
  "denoise",
  "spatial-filter",
  "spectral-derivative",
  "flat-field",
  "spectralon",
  // CT-299: The custom transform's output band count, height, and width are
  // only known after its Python runs at Apply, so it is priced as a
  // source-band-count float32 cube at source dimensions (the best estimate
  // available before the run). This is an upper-bound-style estimate for
  // shrinking transforms (e.g. a spatial crop), which will actually consume
  // less memory; the estimate is conservative and never refuses an operation
  // that would actually fit.
  "custom-transform",
]);

const TYPE_PRESERVING_FULL_CUBE_ACTION_IDS: ReadonlySet<string> = new Set([
  "bit-shift",
  "rotate",
  "reflect",
  "clip-by-value",
]);

// CT-240: dimension reduction outputs keptCount float32 component bands, and
// the fit streams from the source's own band arrays (no cube copy). ICA is the
// one transform with a working set on top of the output: its whitened sample
// matrix holds keptCount float32 axes of the CAPPED FastICA sample count
// (describeFastIcaFitSampling), alive through the whole estimation.
const DIMENSION_REDUCTION_ACTION_IDS: ReadonlySet<string> = new Set(["pca", "mnf", "ica"]);
const ICA_ACTION_ID = "ica";

export function estimateApplyAllocationBytesForAction(
  action: RegisteredViewportAction,
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
): number {
  if (source.kind !== "raster") return 0;
  return estimateAllocationBytesForRasterApply(action, source.raster, parameterValues);
}

// A non-transforming action applied "in a new panel" deep-clones the source
// cube first, so its allocation is the clone itself.
export function estimateSourceCloneBytes(source: ViewportImageSource): number {
  if (source.kind !== "raster") return 0;
  return sumRasterBandBytes(source.raster);
}

function estimateAllocationBytesForRasterApply(
  action: RegisteredViewportAction,
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  if (DIMENSION_REDUCTION_ACTION_IDS.has(action.id)) {
    return estimateDimensionReductionAllocationBytes(action.id, raster, parameterValues);
  }
  if (FLOAT32_FULL_CUBE_ACTION_IDS.has(action.id)) return float32CubeBytes(raster);
  if (TYPE_PRESERVING_FULL_CUBE_ACTION_IDS.has(action.id)) return sumRasterBandBytes(raster);
  if (action.id === "tone-curve") return estimateToneCurveAllocationBytes(raster, parameterValues);
  if (action.id === "invert") return estimateInvertAllocationBytes(raster, parameterValues);
  if (action.id === "threshold") return thresholdCubeBytes(raster);
  if (action.id === "crop-to-region") return estimateCropAllocationBytes(raster, parameterValues);
  if (action.id === CONCATENATE_STACKS_ACTION_ID) {
    return estimateConcatenateStacksAllocationBytes(raster, parameterValues);
  }
  if (action.id === DUPLICATE_BANDS_ACTION_ID) {
    return estimateDuplicateBandsAllocationBytes(raster, parameterValues);
  }
  // CT-309: a kept ROP projection is a float band at source dimensions (the
  // same as the unlisted-action default, pinned explicitly so a future default
  // change cannot silently reprice it). CT-337: a press can deliver several.
  if (action.id === ROP_KEEP_ACTION_ID) {
    return singleFloatBandBytes(raster) * countDeliveredRopProjectionBands(parameterValues);
  }
  // CT-311/CT-312: the spatially adaptive projections return exactly one float
  // band at source dimensions; the cube itself streams to the Python worker
  // band by band, so no second copy of the stack lives in the renderer.
  if (action.id === LOCAL_PCA_ACTION_ID) return singleFloatBandBytes(raster);
  if (action.id === LOCAL_MNF_ACTION_ID) return singleFloatBandBytes(raster);
  // CT-313: the L2 binarization approximation also returns exactly one float
  // band at source dimensions; pinned explicitly for the same reason the ROP
  // keep entry is (so a future unlisted-action default change cannot silently
  // reprice it).
  if (action.id === L2_MINIMIZATION_ACTION_ID) return singleFloatBandBytes(raster);
  return singleFloatBandBytes(raster);
}

// CT-337: the ROP delivery states how many projections it places; a delivery
// that says nothing is the CT-309 single band.
function countDeliveredRopProjectionBands(parameterValues: ParameterValuesById): number {
  const count = parameterValues[ROP_PROJECTION_BAND_COUNT_PARAMETER_ID];
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) return 1;
  return Math.trunc(count);
}

// CT-301: the output keeps the source's own byte count PLUS one band's worth
// of bytes per duplicated band (same type as the source, never widened).
function estimateDuplicateBandsAllocationBytes(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  const duplicatedCount = tryCountDuplicatedBands(parameterValues);
  const bytesPerBand = pixelCountOf(raster) * (raster.bitsPerSample / 8);
  return sumRasterBandBytes(raster) + duplicatedCount * bytesPerBand;
}

function tryCountDuplicatedBands(parameterValues: ParameterValuesById): number {
  if (typeof parameterValues[DUPLICATE_BANDS_PARAMETER_ID_BAND_NUMBERS] !== "string") return 0;
  try {
    return readDuplicatedBandNumbersFromParameterValues(parameterValues).length;
  } catch {
    return 0;
  }
}

// CT-300: pixelCount x totalBandCount x the widened type's byte width, using
// the actual resolved second stack when one is chosen; falls back to the
// active stack's own byte count (a conservative floor) before a second stack
// is picked.
function estimateConcatenateStacksAllocationBytes(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  const second = tryResolveConcatenateStacksSecondStack(parameterValues);
  if (!second) return sumRasterBandBytes(raster);
  const widened = widenSampleType(
    { sampleFormat: raster.sampleFormat, bitsPerSample: raster.bitsPerSample },
    { sampleFormat: second.sampleFormat, bitsPerSample: second.bitsPerSample },
  );
  const totalBandCount = raster.bandCount + second.bandCount;
  return pixelCountOf(raster) * totalBandCount * (widened.bitsPerSample / 8);
}

function tryResolveConcatenateStacksSecondStack(parameterValues: ParameterValuesById): RasterImage | null {
  const token = readRasterReferenceTokenOrEmpty(parameterValues[CONCATENATE_STACKS_SECOND_STACK_PARAMETER_ID]);
  if (token === NO_RASTER_REFERENCE_SELECTED) return null;
  return readRememberedReferenceRasterOrNull(token);
}

function pixelCountOf(raster: RasterImage): number {
  return raster.width * raster.height;
}

// keptCount x W x H x 4 for the float32 component stack; ICA adds its float32
// whitened working set of the capped sample count (see CT-240 notes above).
function estimateDimensionReductionAllocationBytes(
  actionId: string,
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  const keptCount = resolveComponentCount(readComponentCountParameter(parameterValues), raster.bandCount);
  const componentStackBytes = keptCount * pixelCountOf(raster) * FLOAT32_BYTES_PER_SAMPLE;
  if (actionId !== ICA_ACTION_ID) return componentStackBytes;
  return componentStackBytes + estimateIcaWhitenedWorkingSetBytes(raster, keptCount);
}

function estimateIcaWhitenedWorkingSetBytes(raster: RasterImage, keptCount: number): number {
  const { sampledCount } = describeFastIcaFitSampling(pixelCountOf(raster));
  return keptCount * sampledCount * FLOAT32_BYTES_PER_SAMPLE;
}

function readComponentCountParameter(parameterValues: ParameterValuesById): number | undefined {
  const raw = parameterValues[COMPONENT_COUNT_PARAMETER_ID];
  return typeof raw === "number" ? raw : undefined;
}

function float32CubeBytes(raster: RasterImage): number {
  return pixelCountOf(raster) * raster.bandCount * FLOAT32_BYTES_PER_SAMPLE;
}

function singleFloatBandBytes(raster: RasterImage): number {
  return pixelCountOf(raster) * FLOAT32_BYTES_PER_SAMPLE;
}

function thresholdCubeBytes(raster: RasterImage): number {
  return pixelCountOf(raster) * raster.bandCount * THRESHOLD_OUTPUT_BYTES_PER_SAMPLE;
}

// The clone cost of the whole cube: every band's own byte count, aliased bands
// billed per band because type-preserving remaps allocate each output band.
export function sumRasterBandBytes(raster: RasterImage): number {
  let totalBytes = 0;
  for (const band of raster.bandPixels) totalBytes += band.byteLength;
  return totalBytes;
}

function largestBandBytes(raster: RasterImage): number {
  let largest = 0;
  for (const band of raster.bandPixels) largest = Math.max(largest, band.byteLength);
  return largest;
}

function estimateToneCurveAllocationBytes(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  const appliesToWholeStack =
    parameterValues[TONE_CURVE_SCOPE_PARAMETER_ID] === WHOLE_STACK_TONE_CURVE_SCOPE_VALUE;
  return appliesToWholeStack ? sumRasterBandBytes(raster) : largestBandBytes(raster);
}

function estimateInvertAllocationBytes(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  if (readInvertApplyToAllBands(parameterValues)) return sumRasterBandBytes(raster);
  return largestBandBytes(raster);
}

function estimateCropAllocationBytes(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  const cropPixelCount = tryReadCropRegionPixelCount(raster, parameterValues);
  if (cropPixelCount === null) return sumRasterBandBytes(raster);
  const bytesPerSample = largestBandBytes(raster) / Math.max(1, pixelCountOf(raster));
  return Math.ceil(cropPixelCount * raster.bandCount * bytesPerSample);
}

function tryReadCropRegionPixelCount(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number | null {
  try {
    const roi = readRoiFromCropParameterValues(parameterValues);
    const width = Math.min(Math.abs(roi.imagePixelX1 - roi.imagePixelX0) + 1, raster.width);
    const height = Math.min(Math.abs(roi.imagePixelY1 - roi.imagePixelY0) + 1, raster.height);
    return width * height;
  } catch {
    return null;
  }
}
