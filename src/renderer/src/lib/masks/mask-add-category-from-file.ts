import { stripFileExtension } from "@/lib/masks/mask-import";
import {
  appendNamedCategoryToLayer,
  MAX_MASK_CATEGORY_COUNT,
  UNLABELED_MASK_VALUE,
  type MaskLayer,
} from "@/lib/masks/mask-layer";

// CT-332: binary masks often live one file per class in separate folders, and
// the classes belong together in ONE layer. "Add category from file" adds each
// picked PNG to the layer already on the panel, in contrast to Import mask,
// which always creates a new layer.
//
// The rules mirror the multi-file import (mask-multi-file-import.ts): pick
// order is category order, a file's stem names its category, and a pixel that
// more than one file paints takes the LAST file's category. What differs is
// that the categories are APPENDED to an existing layer, so the free slots are
// what is left under MAX_MASK_CATEGORY_COUNT and the pixels a file leaves at 0
// keep whatever the layer already held there.

export interface MaskCategoryFile {
  readonly fileName: string;
  readonly values: Uint8Array;
}

export const MASK_CATEGORY_FROM_ZIP_MESSAGE =
  "Add category from file takes PNG files. Import a zip with Import mask instead.";

export function describeTooManyCategoryFilesOrNull(
  layer: MaskLayer,
  fileCount: number,
): string | null {
  const freeSlots = MAX_MASK_CATEGORY_COUNT - layer.categories.length;
  if (fileCount <= freeSlots) return null;
  return `This layer has ${layer.categories.length} categories; pick at most ${freeSlots} files.`;
}

export function addCategoriesFromMaskFilesToLayer(
  layer: MaskLayer,
  files: ReadonlyArray<MaskCategoryFile>,
): MaskLayer {
  return files.reduce(appendOneFileAsItsOwnCategory, layer);
}

function appendOneFileAsItsOwnCategory(layer: MaskLayer, file: MaskCategoryFile): MaskLayer {
  const withCategory = appendNamedCategoryToLayer(layer, stripFileExtension(file.fileName));
  if (withCategory.categories.length === layer.categories.length) return layer;
  return {
    ...withCategory,
    values: paintFilePixelsWithCategoryValue(
      layer.values,
      file.values,
      withCategory.categories.length,
    ),
  };
}

// Returns a new array: the layer being edited may be the one the overlay is
// reading, so nothing here writes into the values it was handed.
function paintFilePixelsWithCategoryValue(
  values: Uint8Array,
  fileValues: Uint8Array,
  categoryValue: number,
): Uint8Array {
  const next = new Uint8Array(values);
  for (let index = 0; index < next.length; index += 1) {
    if (fileValues[index] !== UNLABELED_MASK_VALUE) next[index] = categoryValue;
  }
  return next;
}
