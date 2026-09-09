import { describe, expect, it } from "vitest";

import {
  addCategoriesFromMaskFilesToLayer,
  describeTooManyCategoryFilesOrNull,
  MASK_CATEGORY_FROM_ZIP_MESSAGE,
} from "@/lib/masks/mask-add-category-from-file";
import {
  addCategoryToLayer,
  createMaskLayer,
  DEFAULT_MASK_CATEGORY_COLORS,
  type MaskLayer,
} from "@/lib/masks/mask-layer";

// CT-332: each picked PNG becomes one more category of the layer already on
// the panel. Pick order is category order, later files win the pixels they
// share, and a pixel a file leaves at 0 keeps whatever the layer held there.

function buildOneCategoryLayer(paintedValues: ReadonlyArray<number>): MaskLayer {
  const layer = createMaskLayer("mask-1", "Parchment mask", 4, 1);
  layer.values.set(paintedValues);
  return { ...layer, categories: [layer.categories[0]!] };
}

function buildFile(fileName: string, values: ReadonlyArray<number>) {
  return { fileName, values: Uint8Array.from(values) };
}

describe("addCategoriesFromMaskFilesToLayer", () => {
  it("appends one category painting exactly the file's non-zero pixels", () => {
    const layer = buildOneCategoryLayer([1, 1, 0, 0]);

    const next = addCategoriesFromMaskFilesToLayer(layer, [buildFile("text.png", [0, 0, 1, 0])]);

    expect(next.categories).toHaveLength(2);
    expect(Array.from(next.values)).toEqual([1, 1, 2, 0]);
  });

  it("names each new category after its file's stem and colours it in order", () => {
    const layer = buildOneCategoryLayer([0, 0, 0, 0]);

    const next = addCategoriesFromMaskFilesToLayer(layer, [
      buildFile("gold leaf.png", [1, 0, 0, 0]),
      buildFile("iron gall.PNG", [0, 1, 0, 0]),
    ]);

    expect(next.categories.map((category) => category.name)).toEqual([
      "Foreground",
      "gold leaf",
      "iron gall",
    ]);
    expect(next.categories.map((category) => category.color)).toEqual([
      DEFAULT_MASK_CATEGORY_COLORS[0],
      DEFAULT_MASK_CATEGORY_COLORS[1],
      DEFAULT_MASK_CATEGORY_COLORS[2],
    ]);
  });

  it("lets the later file win every pixel the two files share", () => {
    const layer = buildOneCategoryLayer([0, 0, 0, 0]);

    const next = addCategoriesFromMaskFilesToLayer(layer, [
      buildFile("first.png", [1, 1, 0, 0]),
      buildFile("second.png", [1, 0, 1, 0]),
    ]);

    expect(Array.from(next.values)).toEqual([3, 2, 3, 0]);
  });

  it("overwrites what the layer already held wherever a file paints", () => {
    const layer = buildOneCategoryLayer([1, 1, 1, 0]);

    const next = addCategoriesFromMaskFilesToLayer(layer, [buildFile("over.png", [1, 1, 0, 0])]);

    expect(Array.from(next.values)).toEqual([2, 2, 1, 0]);
  });

  it("paints from a 0/255 binary file, whose non-zero value is not an index", () => {
    const layer = buildOneCategoryLayer([0, 0, 0, 0]);

    const next = addCategoriesFromMaskFilesToLayer(layer, [
      buildFile("binary.png", [255, 255, 0, 0]),
    ]);

    expect(Array.from(next.values)).toEqual([2, 2, 0, 0]);
  });

  it("leaves the layer it was handed untouched", () => {
    const layer = buildOneCategoryLayer([1, 0, 0, 0]);

    addCategoriesFromMaskFilesToLayer(layer, [buildFile("text.png", [0, 1, 1, 1])]);

    expect(Array.from(layer.values)).toEqual([1, 0, 0, 0]);
    expect(layer.categories).toHaveLength(1);
  });
});

describe("describeTooManyCategoryFilesOrNull", () => {
  it("accepts a pick that fits the layer's free category slots", () => {
    const layer = buildOneCategoryLayer([0, 0, 0, 0]);

    expect(describeTooManyCategoryFilesOrNull(layer, 4)).toBeNull();
  });

  it("refuses a pick wider than the free slots, naming both counts", () => {
    const layer = addCategoryToLayer(addCategoryToLayer(buildOneCategoryLayer([0, 0, 0, 0])));

    expect(describeTooManyCategoryFilesOrNull(layer, 4)).toBe(
      "This layer has 3 categories; pick at most 2 files.",
    );
  });
});

describe("MASK_CATEGORY_FROM_ZIP_MESSAGE", () => {
  it("points a picked zip at the Import mask button", () => {
    expect(MASK_CATEGORY_FROM_ZIP_MESSAGE).toBe(
      "Add category from file takes PNG files. Import a zip with Import mask instead.",
    );
  });
});
