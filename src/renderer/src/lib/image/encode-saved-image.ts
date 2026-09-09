import {
  emitBufferInBoundedSlicesInOrder,
  type ByteChunkConsumer,
} from "@/lib/image/emit-byte-chunks";
import {
  encodeViewportSourceAsCanvasBlobBytes,
  readRgbaBytesFromBrowserSource,
} from "@/lib/image/encode-canvas";
import {
  encodeRasterImageAsEnviFilesReportingProgress,
  encodeRasterImageAsFloat32EnviFilesReportingProgress,
  planEnviFilesChunkedEncoding,
  planFloat32EnviFilesChunkedEncoding,
  type EnviChunkedEncoding,
  type EnviEncodedFiles,
} from "@/lib/image/encode-envi";
import { planRasterBandAsRawPng16SampleUpload } from "@/lib/image/encode-png16-raw-samples";
import { encodeRasterBandAsGrayscalePng8Bytes } from "@/lib/image/encode-raster-band-as-grayscale-png8";
import {
  encodeRasterBandAsFloat32TiffBytesReportingProgress,
  encodeRasterBandAsSingleChannelTiffBytesReportingProgress,
  encodeRgbaBytesAsRgbTiffBytesReportingProgress,
  encodeRgbRasterAsRgbTiffBytesReportingProgress,
} from "@/lib/image/encode-tiff";
import type { ViewportDisplayMappingState } from "@/lib/image/as-viewed-display-mapping";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import {
  readSaveImageFormatTechnicalDetails,
  type SaveImageFormatId,
  type SaveImageFormatKind,
  type SaveImageSampleFormat,
} from "@/lib/image/save-image-formats";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import type { SaveImagePartEncoding } from "@shared/chunked-save-image-protocol";

export interface EncodeSavedImageInput {
  readonly source: ViewportImageSource;
  readonly selectedBandIndex: number;
  readonly formatId: SaveImageFormatId;
  // CT-296: PNG and JPEG save the image AS VIEWED, so they need the panel's
  // display state. The data formats ignore it and keep writing raw data.
  readonly displayMapping: ViewportDisplayMappingState;
  // CT-219f: TIFF and ENVI encodes report determinate 0..1 progress; the canvas
  // formats (PNG, JPEG) are single-shot and keep the indeterminate spinner.
  readonly onProgress?: UnitProgressCallback;
}

export interface EncodedSavedImageSidecarFile {
  readonly extension: string;
  readonly bytes: Uint8Array;
}

export interface EncodedSavedImage {
  readonly bytes: Uint8Array;
  readonly sidecar?: EncodedSavedImageSidecarFile;
}

export async function encodeViewportSourceForSaving(
  input: EncodeSavedImageInput,
): Promise<EncodedSavedImage> {
  if (input.formatId === "png-16-bit") {
    throw new Error("16-bit PNG encodes in the main process; use planViewportSourceSaveUpload.");
  }
  const details = readSaveImageFormatTechnicalDetails(input.formatId);
  if (details.kind === "png-stack") {
    throw new Error("PNG stack exports through the folder flow; use planPngStackExportUpload.");
  }
  return dispatchEncodingByFormatKind(input, details.kind, details.targetBitDepth, details.targetSampleFormat);
}

// CT-237: the save flow uploads the encoded export through the chunked
// save-image protocol, so it consumes chunk-emitting PLANS instead of whole
// buffers. TIFF/PNG/JPEG encodes stay eager (single band or view, small) and
// are re-emitted in bounded slices; ENVI plans emit their multi-gigabyte
// binary on demand (CT-235 emitters), so no whole-sidecar buffer ever exists.
export interface SaveImageUploadPartPlan {
  readonly byteLength: number;
  readonly emitChunksInOrder: (
    maxChunkBytes: number,
    onChunk: ByteChunkConsumer,
  ) => Promise<void>;
}

export interface SaveImageUploadSidecarPlan {
  readonly extension: string;
  readonly plan: SaveImageUploadPartPlan;
}

export interface SaveImageUploadPlan {
  readonly primary: SaveImageUploadPartPlan;
  // CT-271: when set, the primary part's chunks are RAW payload bytes that the
  // MAIN process encodes on the way to disk (16-bit PNG via Node zlib).
  readonly primaryEncoding?: SaveImagePartEncoding;
  readonly sidecar?: SaveImageUploadSidecarPlan;
}

export async function planViewportSourceSaveUpload(
  input: EncodeSavedImageInput,
): Promise<SaveImageUploadPlan> {
  if (input.formatId === "png-16-bit") {
    return planSixteenBitPngSaveUploadFromRawSamples(input);
  }
  const details = readSaveImageFormatTechnicalDetails(input.formatId);
  if (details.kind === "png-stack") {
    throw new Error("PNG stack exports through the folder flow; use planPngStackExportUpload.");
  }
  if (details.kind === "envi") {
    return planEnviSaveUploadWithoutMaterializingBinary(input, details.targetSampleFormat);
  }
  const encoded = await dispatchEncodingByFormatKind(
    input,
    details.kind,
    details.targetBitDepth,
    details.targetSampleFormat,
  );
  return { primary: wrapEncodedBytesAsUploadPartPlan(encoded.bytes) };
}

function planSixteenBitPngSaveUploadFromRawSamples(
  input: EncodeSavedImageInput,
): SaveImageUploadPlan {
  const raster = requireIntegerGrayscaleRasterForSixteenBitPng(input.source);
  return {
    primary: planRasterBandAsRawPng16SampleUpload(raster, input.selectedBandIndex),
    primaryEncoding: {
      kind: "png-16-bit-grayscale",
      width: raster.width,
      height: raster.height,
    },
  };
}

// Safety net behind the picker's CT-271 disabled-reason gating.
function requireIntegerGrayscaleRasterForSixteenBitPng(
  source: ViewportImageSource,
): RasterImage {
  if (source.kind !== "raster") {
    throw new Error("16-bit PNG export needs raster data.");
  }
  if (source.raster.sampleFormat === "float") {
    throw new Error("16-bit PNG stores integers. Use ENVI float for float data.");
  }
  if (shouldRenderRasterAsRgbComposite(source.raster)) {
    throw new Error("Color photos are 8-bit; use PNG (8-bit) instead.");
  }
  return source.raster;
}

function planEnviSaveUploadWithoutMaterializingBinary(
  input: EncodeSavedImageInput,
  targetSampleFormat: SaveImageSampleFormat,
): SaveImageUploadPlan {
  rejectNonRasterSourceForEnviWrite(input.source);
  const encoding = planEnviEncodingForSampleFormat(input.source.raster, targetSampleFormat);
  return {
    primary: wrapEncodedBytesAsUploadPartPlan(encoding.headerBytes),
    sidecar: {
      extension: "bin",
      plan: {
        byteLength: encoding.binaryByteLength,
        emitChunksInOrder: encoding.emitBinaryChunksInOrder,
      },
    },
  };
}

function planEnviEncodingForSampleFormat(
  raster: Extract<ViewportImageSource, { kind: "raster" }>["raster"],
  targetSampleFormat: SaveImageSampleFormat,
): EnviChunkedEncoding {
  if (targetSampleFormat === "float") return planFloat32EnviFilesChunkedEncoding(raster);
  return planEnviFilesChunkedEncoding(raster);
}

function wrapEncodedBytesAsUploadPartPlan(bytes: Uint8Array): SaveImageUploadPartPlan {
  return {
    byteLength: bytes.byteLength,
    emitChunksInOrder: (maxChunkBytes, onChunk) =>
      emitBufferInBoundedSlicesInOrder(bytes, maxChunkBytes, onChunk),
  };
}

async function dispatchEncodingByFormatKind(
  input: EncodeSavedImageInput,
  kind: SaveImageFormatKind,
  targetBitDepth: 8 | 16,
  targetSampleFormat: SaveImageSampleFormat,
): Promise<EncodedSavedImage> {
  if (kind === "tiff") return encodeViewportSourceAsTiff(input, targetBitDepth, targetSampleFormat);
  if (kind === "envi") return encodeViewportSourceAsEnviFiles(input, targetSampleFormat);
  if (kind === "png") return encodeViewportSourceAsPng(input);
  return encodeViewportSourceAsCanvasBlob(input, kind);
}

// CT-339: a single-band raster (not a colour photo) writes a one-channel
// grayscale PNG; a colour photo, an RGB-tagged raster, or a browser-decoded
// photo source keeps the RGBA canvas path unchanged.
async function encodeViewportSourceAsPng(input: EncodeSavedImageInput): Promise<EncodedSavedImage> {
  if (input.source.kind === "raster" && !shouldRenderRasterAsRgbComposite(input.source.raster)) {
    const bytes = await encodeRasterBandAsGrayscalePng8Bytes(
      input.source.raster,
      input.selectedBandIndex,
      input.displayMapping,
    );
    return { bytes };
  }
  return encodeViewportSourceAsCanvasBlob(input, "png");
}

async function encodeViewportSourceAsCanvasBlob(
  input: EncodeSavedImageInput,
  kind: SaveImageFormatKind,
): Promise<EncodedSavedImage> {
  const bytes = await encodeViewportSourceAsCanvasBlobBytes(input.source, input.selectedBandIndex, {
    mimeType: kind === "png" ? "image/png" : "image/jpeg",
    displayMapping: input.displayMapping,
  });
  return { bytes };
}

async function encodeViewportSourceAsTiff(
  input: EncodeSavedImageInput,
  targetBitDepth: 8 | 16,
  targetSampleFormat: SaveImageSampleFormat,
): Promise<EncodedSavedImage> {
  if (input.source.kind === "raster") {
    const bytes = await encodeRasterBandAsTiffBytesReportingProgress(
      input.source.raster,
      input.selectedBandIndex,
      targetBitDepth,
      targetSampleFormat,
      input.onProgress,
    );
    return { bytes };
  }
  const rgba = await readRgbaBytesFromBrowserSource(input.source);
  const bytes = await encodeRgbaBytesAsRgbTiffBytesReportingProgress(
    rgba.rgba,
    rgba.width,
    rgba.height,
    targetBitDepth,
    input.onProgress,
  );
  return { bytes };
}

async function encodeRasterBandAsTiffBytesReportingProgress(
  raster: Extract<ViewportImageSource, { kind: "raster" }>["raster"],
  selectedBandIndex: number,
  targetBitDepth: 8 | 16,
  targetSampleFormat: SaveImageSampleFormat,
  onProgress: UnitProgressCallback | undefined,
): Promise<Uint8Array> {
  if (targetSampleFormat === "float") {
    return encodeRasterBandAsFloat32TiffBytesReportingProgress(raster, selectedBandIndex, onProgress);
  }
  if (shouldRenderRasterAsRgbComposite(raster)) {
    return encodeRgbRasterAsRgbTiffBytesReportingProgress(raster, targetBitDepth, onProgress);
  }
  return encodeRasterBandAsSingleChannelTiffBytesReportingProgress(
    raster,
    selectedBandIndex,
    targetBitDepth,
    onProgress,
  );
}

async function encodeViewportSourceAsEnviFiles(
  input: EncodeSavedImageInput,
  targetSampleFormat: SaveImageSampleFormat,
): Promise<EncodedSavedImage> {
  rejectNonRasterSourceForEnviWrite(input.source);
  const encoded = await encodeEnviFilesForSampleFormatReportingProgress(
    input.source.raster,
    targetSampleFormat,
    input.onProgress,
  );
  return {
    bytes: encoded.headerBytes,
    sidecar: { extension: "bin", bytes: encoded.binaryBytes },
  };
}

async function encodeEnviFilesForSampleFormatReportingProgress(
  raster: Extract<ViewportImageSource, { kind: "raster" }>["raster"],
  targetSampleFormat: SaveImageSampleFormat,
  onProgress: UnitProgressCallback | undefined,
): Promise<EnviEncodedFiles> {
  if (targetSampleFormat === "float") {
    return encodeRasterImageAsFloat32EnviFilesReportingProgress(raster, onProgress);
  }
  return encodeRasterImageAsEnviFilesReportingProgress(raster, onProgress);
}

function rejectNonRasterSourceForEnviWrite(
  source: ViewportImageSource,
): asserts source is Extract<ViewportImageSource, { kind: "raster" }> {
  if (source.kind !== "raster") {
    throw new Error("ENVI export is only supported for raster sources (TIFF, ENVI, raw)");
  }
}
