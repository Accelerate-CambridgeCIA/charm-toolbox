import type { ViewportDisplayMappingState } from "@/lib/image/as-viewed-display-mapping";
import { planRasterBandAsRawPng16SampleUpload } from "@/lib/image/encode-png16-raw-samples";
import { encodeRasterBandAsGrayscalePng8Bytes } from "@/lib/image/encode-raster-band-as-grayscale-png8";
import type { SaveImageUploadPartPlan } from "@/lib/image/encode-saved-image";
import {
  emitBufferInBoundedSlicesInOrder,
} from "@/lib/image/emit-byte-chunks";
import { listPngStackBandFileNames } from "@/lib/image/png-stack-file-names";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import type { RasterImage } from "@/lib/image/raster-image";
import type { SaveImageFormatId } from "@/lib/image/save-image-formats";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import type { SaveImagePartEncoding } from "@shared/chunked-save-image-protocol";

// CT-273: plans the PNG stack folder export (one PNG file per band). The
// 16-bit variant streams each band's RAW big-endian uint16 samples and lets
// MAIN encode (the CT-271 path per band); the 8-bit variant encodes each band
// eagerly through the same grayscale encoder as the single-band PNG (8-bit)
// export (CT-339), so a stack file is byte-identical to saving that band alone.

export interface PngStackFileUploadPlan {
  readonly fileName: string;
  readonly plan: SaveImageUploadPartPlan;
  readonly encoding?: SaveImagePartEncoding;
}

export type EncodeBandAsPng8Bytes = (
  raster: RasterImage,
  bandIndex: number,
  displayMapping: ViewportDisplayMappingState,
) => Promise<Uint8Array>;

export interface PlanPngStackExportInput {
  readonly source: ViewportImageSource;
  readonly originalFileName: string;
  readonly formatId: SaveImageFormatId;
  // CT-296: each 8-bit band file is byte-identical to saving that band alone,
  // so the stack export carries the same as-viewed display state.
  readonly displayMapping: ViewportDisplayMappingState;
  readonly onProgress?: UnitProgressCallback;
  readonly encodeBandAsPng8Bytes?: EncodeBandAsPng8Bytes;
}

export async function planPngStackExportUpload(
  input: PlanPngStackExportInput,
): Promise<ReadonlyArray<PngStackFileUploadPlan>> {
  const raster = requireScientificMultiBandRasterForPngStack(input.source, input.formatId);
  const fileNames = listPngStackBandFileNames(input.originalFileName, raster.bandCount);
  if (input.formatId === "png-stack-16-bit") {
    return planSixteenBitPngStackFiles(raster, fileNames);
  }
  return planEightBitPngStackFiles(raster, fileNames, input);
}

// Safety net behind the picker's CT-273 disabled-reason gating.
export function requireScientificMultiBandRasterForPngStack(
  source: ViewportImageSource,
  formatId: SaveImageFormatId,
): RasterImage {
  if (source.kind !== "raster" || shouldRenderRasterAsRgbComposite(source.raster)) {
    throw new Error("PNG stack export needs a multi-band scientific stack.");
  }
  if (source.raster.bandCount < 2) {
    throw new Error("PNG stack saves one file per band; a single-band image saves as one PNG.");
  }
  if (formatId === "png-stack-16-bit" && source.raster.sampleFormat === "float") {
    throw new Error("16-bit PNG stores integers. Use ENVI float for float data.");
  }
  return source.raster;
}

function planSixteenBitPngStackFiles(
  raster: RasterImage,
  fileNames: ReadonlyArray<string>,
): ReadonlyArray<PngStackFileUploadPlan> {
  return fileNames.map((fileName, bandIndex) => ({
    fileName,
    plan: planRasterBandAsRawPng16SampleUpload(raster, bandIndex),
    encoding: { kind: "png-16-bit-grayscale", width: raster.width, height: raster.height },
  }));
}

async function planEightBitPngStackFiles(
  raster: RasterImage,
  fileNames: ReadonlyArray<string>,
  input: PlanPngStackExportInput,
): Promise<ReadonlyArray<PngStackFileUploadPlan>> {
  const encodeBand = input.encodeBandAsPng8Bytes ?? encodeRasterBandAsGrayscalePng8Bytes;
  const files: PngStackFileUploadPlan[] = [];
  for (let bandIndex = 0; bandIndex < fileNames.length; bandIndex += 1) {
    const bytes = await encodeBand(raster, bandIndex, input.displayMapping);
    files.push({ fileName: fileNames[bandIndex]!, plan: wrapEncodedPngBytesAsPlan(bytes) });
    input.onProgress?.((bandIndex + 1) / fileNames.length);
  }
  return files;
}

function wrapEncodedPngBytesAsPlan(bytes: Uint8Array): SaveImageUploadPartPlan {
  return {
    byteLength: bytes.byteLength,
    emitChunksInOrder: (maxChunkBytes, onChunk) =>
      emitBufferInBoundedSlicesInOrder(bytes, maxChunkBytes, onChunk),
  };
}
