import {
  addCategoriesFromMaskFilesToLayer,
  describeTooManyCategoryFilesOrNull,
  MASK_CATEGORY_FROM_ZIP_MESSAGE,
  type MaskCategoryFile,
} from "@/lib/masks/mask-add-category-from-file";
import {
  buildImportedMaskLayerContent,
  describeMaskDimensionMismatchOrNull,
  describeMaskFileDimensionMismatchOrNull,
  remapMaskValuesToCategoryIndexes,
  type MaskGridSize,
} from "@/lib/masks/mask-import";
import type { MaskLayer, MaskLayerContent } from "@/lib/masks/mask-layer";
import {
  combineMaskFilesIntoOneLayer,
  refuseMoreMaskFilesThanCategories,
  type MaskFileToCombine,
} from "@/lib/masks/mask-multi-file-import";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import { parseMaskSidecarDocumentOrNull } from "@/lib/masks/mask-sidecar";
import {
  buildMaskLayerContentFromZipEntries,
  type RefuseMaskFileThatDoesNotCoverTheStack,
} from "@/lib/masks/mask-zip-import";
import { readZipArchiveEntries } from "@/lib/masks/zip-store-reader";

// CT-303/CT-328: importing a mask picks one or more files through main
// (metadata plus each PNG's JSON sidecar), streams every file's bytes through
// the chunked opened-image read like any other picked file, and builds the
// layer in the renderer. A mask that does not cover the active stack's grid is
// refused before it can become a layer.
//
// The pick has three shapes, and each produces exactly ONE layer:
// - one PNG: the CT-303 import, sidecar-named when a sidecar sits beside it;
// - one zip: rebuilt losslessly from the toolbox's own pair inside it, or read
//   as one category per PNG entry (mask-zip-import.ts);
// - several PNGs: one category per file in pick order (mask-multi-file-import.ts).
//
// CT-332: the SAME picker also serves "Add category from file", which appends
// the picked PNGs to the layer already selected instead of creating one.

export interface MaskImportTarget {
  readonly width: number;
  readonly height: number;
}

export type MaskAddCategoriesResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly layer: MaskLayer };

export type MaskImportResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly content: MaskLayerContent };

export interface MaskImportFlowApi {
  importMaskDialog(): Promise<ToolboxMaskImportDialogResult>;
  readOpenedImageFile(
    metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  ): Promise<ToolboxOpenedImagesFileEntry>;
}

interface PickedMaskFile {
  readonly file: ToolboxOpenImagesDialogFileMetadataEntry;
  readonly sidecarText: string | null;
}

const ZIP_FILE_EXTENSION = ".zip";

export async function importMaskLayerThroughOpenDialog(
  target: MaskImportTarget,
  api: MaskImportFlowApi = window.toolboxApi,
): Promise<MaskImportResult> {
  const picked = await api.importMaskDialog();
  if (picked.canceled) return { canceled: true };
  return {
    canceled: false,
    content: await buildLayerContentFromPickedFiles(target, picked.files, api),
  };
}

async function buildLayerContentFromPickedFiles(
  target: MaskImportTarget,
  files: ReadonlyArray<PickedMaskFile>,
  api: MaskImportFlowApi,
): Promise<MaskLayerContent> {
  const onlyPickedFile = files.length === 1 ? files[0] : undefined;
  if (onlyPickedFile === undefined) return buildLayerFromSeveralPngFiles(target, files, api);
  if (isZipFileName(onlyPickedFile.file.fileName)) {
    return buildLayerFromOneZipFile(target, onlyPickedFile, api);
  }
  return buildLayerFromOneMaskPng(target, onlyPickedFile, api);
}

function isZipFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(ZIP_FILE_EXTENSION);
}

async function buildLayerFromOneMaskPng(
  target: MaskImportTarget,
  picked: PickedMaskFile,
  api: MaskImportFlowApi,
): Promise<MaskLayerContent> {
  const decoded = await decodeMaskPngBytes(await readPickedFileBytes(api, picked));
  refuseMaskThatDoesNotCoverTheStack(decoded, target);
  return buildImportedMaskLayerContent({
    fileName: picked.file.fileName,
    decoded,
    sidecar: picked.sidecarText === null ? null : parseMaskSidecarDocumentOrNull(picked.sidecarText),
  });
}

async function buildLayerFromOneZipFile(
  target: MaskImportTarget,
  picked: PickedMaskFile,
  api: MaskImportFlowApi,
): Promise<MaskLayerContent> {
  const entries = await readZipArchiveEntries(await readPickedFileBytes(api, picked));
  return buildMaskLayerContentFromZipEntries(entries, buildStackCoverageGuard(target));
}

async function buildLayerFromSeveralPngFiles(
  target: MaskImportTarget,
  files: ReadonlyArray<PickedMaskFile>,
  api: MaskImportFlowApi,
): Promise<MaskLayerContent> {
  refuseMoreMaskFilesThanCategories(files.length);
  const decodedFiles = await Promise.all(
    files.map((picked) => decodePickedFileAsMaskFile(api, picked)),
  );
  const refuseMaskFile = buildStackCoverageGuard(target);
  decodedFiles.forEach((file) => refuseMaskFile(file.fileName, file.decoded));
  return combineMaskFilesIntoOneLayer(decodedFiles);
}

async function decodePickedFileAsMaskFile(
  api: MaskImportFlowApi,
  picked: PickedMaskFile,
): Promise<MaskFileToCombine> {
  return {
    fileName: picked.file.fileName,
    decoded: await decodeMaskPngBytes(await readPickedFileBytes(api, picked)),
  };
}

async function readPickedFileBytes(
  api: MaskImportFlowApi,
  picked: PickedMaskFile,
): Promise<Uint8Array> {
  return (await api.readOpenedImageFile(picked.file)).bytes;
}

function buildStackCoverageGuard(
  target: MaskImportTarget,
): RefuseMaskFileThatDoesNotCoverTheStack {
  return (fileName, decoded) => {
    const mismatch = describeMaskFileDimensionMismatchOrNull(
      fileName,
      decoded,
      target.width,
      target.height,
    );
    if (mismatch !== null) throw new Error(mismatch);
  };
}

// A single picked PNG keeps the original, file-name-free message: the user is
// looking at the one file they just chose.
function refuseMaskThatDoesNotCoverTheStack(
  decoded: MaskGridSize,
  target: MaskImportTarget,
): void {
  const mismatch = describeMaskDimensionMismatchOrNull(decoded, target.width, target.height);
  if (mismatch !== null) throw new Error(mismatch);
}

// CT-332: the same picker, but every picked PNG becomes a CATEGORY of the
// layer already selected instead of a new layer. A zip is refused here (the
// Import mask button is where an archive belongs) and a pick wider than the
// layer's free category slots is refused before any file is read.
export async function addMaskCategoriesFromFilesThroughOpenDialog(
  layer: MaskLayer,
  api: MaskImportFlowApi = window.toolboxApi,
): Promise<MaskAddCategoriesResult> {
  const picked = await api.importMaskDialog();
  if (picked.canceled) return { canceled: true };
  const files = await readPickedFilesAsCategoryFiles(layer, picked.files, api);
  return { canceled: false, layer: addCategoriesFromMaskFilesToLayer(layer, files) };
}

async function readPickedFilesAsCategoryFiles(
  layer: MaskLayer,
  picked: ReadonlyArray<PickedMaskFile>,
  api: MaskImportFlowApi,
): Promise<ReadonlyArray<MaskCategoryFile>> {
  refusePicksThatCannotBecomeCategoriesOfTheLayer(layer, picked);
  const decodedFiles = await Promise.all(
    picked.map((file) => decodePickedFileAsMaskFile(api, file)),
  );
  const refuseMaskFile = buildStackCoverageGuard(layer);
  decodedFiles.forEach((file) => refuseMaskFile(file.fileName, file.decoded));
  return decodedFiles.map(describeDecodedFileAsCategoryFile);
}

function refusePicksThatCannotBecomeCategoriesOfTheLayer(
  layer: MaskLayer,
  picked: ReadonlyArray<PickedMaskFile>,
): void {
  if (picked.some((entry) => isZipFileName(entry.file.fileName))) {
    throw new Error(MASK_CATEGORY_FROM_ZIP_MESSAGE);
  }
  const tooManyFiles = describeTooManyCategoryFilesOrNull(layer, picked.length);
  if (tooManyFiles !== null) throw new Error(tooManyFiles);
}

// A file painting any non-zero value labels that pixel, whatever the value; the
// remap keeps a multi-valued PNG within the category range so a file the app
// cannot represent is still refused rather than silently collapsed.
function describeDecodedFileAsCategoryFile(file: MaskFileToCombine): MaskCategoryFile {
  return {
    fileName: file.fileName,
    values: remapMaskValuesToCategoryIndexes(file.decoded.values),
  };
}
