import { describe, expect, it, vi } from "vitest";

import { buildMaskLayerZipEntries } from "@/lib/masks/mask-export-zip";
import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { MASK_CATEGORY_FROM_ZIP_MESSAGE } from "@/lib/masks/mask-add-category-from-file";
import { COMBINED_MASK_LAYER_NAME } from "@/lib/masks/mask-multi-file-import";
import { encodeMaskValuesAsGrayscalePngBytes } from "@/lib/masks/mask-png-encode";
import { ZIP_WITHOUT_MASK_PNGS_MESSAGE } from "@/lib/masks/mask-zip-import";
import {
  addMaskCategoriesFromFilesThroughOpenDialog,
  importMaskLayerThroughOpenDialog,
  type MaskImportFlowApi,
} from "@/lib/masks/run-mask-import-flow";
import { buildStoredZipArchiveBytes } from "@/lib/masks/zip-store-writer";

// CT-303: the import picks the PNG through main (metadata plus the optional
// sidecar text), streams the file bytes through the chunked opened-image read,
// and refuses a mask that does not cover the active stack.
//
// CT-328: the pick can also be SEVERAL PNGs (one category per file, in pick
// order) or ONE zip (rebuilt losslessly from the toolbox's own pair inside it,
// or read as one category per PNG entry).

const STACK = { width: 4, height: 2 };

const SIDECAR_TEXT = JSON.stringify({
  formatVersion: 1,
  name: "Parchment mask",
  width: 4,
  height: 2,
  categories: [
    { index: 1, name: "Parchment", color: "#111111" },
    { index: 2, name: "Substrate", color: "#222222" },
  ],
  opacity: 60,
});

interface FakePickedFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly sidecarText?: string | null;
}

function createFakeImportApi(files: ReadonlyArray<FakePickedFile>): MaskImportFlowApi {
  const bytesByFileName = new Map(files.map((file) => [file.fileName, file.bytes]));
  return {
    importMaskDialog: vi.fn(async () => ({
      canceled: false as const,
      files: files.map((file) => ({
        file: describeFileMetadata(file),
        sidecarText: file.sidecarText ?? null,
      })),
    })),
    readOpenedImageFile: vi.fn(async (metadata) => ({
      ...metadata,
      contentHash: "hash",
      bytes: bytesByFileName.get(metadata.fileName) ?? new Uint8Array(),
    })),
  };
}

function describeFileMetadata(file: FakePickedFile) {
  return {
    fileName: file.fileName,
    filePath: `C:/masks/${file.fileName}`,
    fileSizeBytes: file.bytes.byteLength,
    mtimeMs: 0,
  };
}

function createCanceledImportApi(): MaskImportFlowApi {
  return {
    importMaskDialog: vi.fn(async () => ({ canceled: true as const })),
    readOpenedImageFile: vi.fn(),
  };
}

async function buildMaskPngFile(options: {
  fileName?: string;
  width?: number;
  height?: number;
  values?: ReadonlyArray<number>;
  sidecarText?: string | null;
}): Promise<FakePickedFile> {
  const width = options.width ?? 4;
  const height = options.height ?? 2;
  const values = Uint8Array.from(options.values ?? [0, 1, 1, 0, 2, 2, 0, 0]);
  return {
    fileName: options.fileName ?? "mask-multiband.png",
    bytes: await encodeMaskValuesAsGrayscalePngBytes(width, height, values),
    sidecarText: options.sidecarText ?? null,
  };
}

function buildTwoCategoryLayer(): MaskLayer {
  const layer = createMaskLayer("mask-1", "Parchment mask", 4, 2);
  layer.values.set([0, 1, 1, 0, 2, 2, 0, 0]);
  return {
    ...layer,
    opacityPercent: 60,
    categories: [
      { ...layer.categories[0]!, name: "Parchment", color: "#111111" },
      { ...layer.categories[1]!, name: "Substrate", color: "#222222" },
    ],
  };
}

async function buildExportedMaskZipFile(fileName = "Parchment mask.zip"): Promise<FakePickedFile> {
  const entries = await buildMaskLayerZipEntries(buildTwoCategoryLayer());
  return { fileName, bytes: buildStoredZipArchiveBytes(entries) };
}

describe("importMaskLayerThroughOpenDialog", () => {
  it("builds a layer from the picked PNG and its sidecar", async () => {
    const api = createFakeImportApi([await buildMaskPngFile({ sidecarText: SIDECAR_TEXT })]);
    const result = await importMaskLayerThroughOpenDialog(STACK, api);

    expect(result.canceled).toBe(false);
    if (result.canceled) return;
    expect(result.content.name).toBe("Parchment mask");
    expect(result.content.opacityPercent).toBe(60);
    expect(Array.from(result.content.values)).toEqual([0, 1, 1, 0, 2, 2, 0, 0]);
    expect(result.content.categories.map((category) => category.name)).toEqual([
      "Parchment",
      "Substrate",
    ]);
  });

  it("falls back to default category names when no sidecar sits beside the PNG", async () => {
    const api = createFakeImportApi([await buildMaskPngFile({})]);
    const result = await importMaskLayerThroughOpenDialog(STACK, api);

    expect(result.canceled).toBe(false);
    if (result.canceled) return;
    expect(result.content.name).toBe("mask-multiband");
    expect(result.content.categories.map((category) => category.name)).toEqual([
      "Foreground",
      "Background",
    ]);
  });

  it("reports a cancelled dialog without reading any file", async () => {
    const api = createCanceledImportApi();
    expect(await importMaskLayerThroughOpenDialog(STACK, api)).toEqual({ canceled: true });
    expect(api.readOpenedImageFile).not.toHaveBeenCalled();
  });

  it("refuses a mask whose grid does not match the stack", async () => {
    const api = createFakeImportApi([
      await buildMaskPngFile({ width: 8, height: 8, values: new Array(64).fill(0) }),
    ]);
    await expect(importMaskLayerThroughOpenDialog(STACK, api)).rejects.toThrow(
      "This mask is 8 x 8 but the stack is 4 x 2. Import a mask that matches the stack's size.",
    );
  });

  it("refuses a mask holding more than five categories", async () => {
    const api = createFakeImportApi([
      await buildMaskPngFile({ values: [0, 1, 2, 3, 4, 5, 6, 0] }),
    ]);
    await expect(importMaskLayerThroughOpenDialog(STACK, api)).rejects.toThrow(
      "A mask layer holds at most 5 categories",
    );
  });

  it("rebuilds the exported layer from a picked zip", async () => {
    const api = createFakeImportApi([await buildExportedMaskZipFile()]);
    const result = await importMaskLayerThroughOpenDialog(STACK, api);

    expect(result.canceled).toBe(false);
    if (result.canceled) return;
    expect(result.content.name).toBe("Parchment mask");
    expect(result.content.opacityPercent).toBe(60);
    expect(Array.from(result.content.values)).toEqual([0, 1, 1, 0, 2, 2, 0, 0]);
    expect(result.content.categories.map((category) => category.color)).toEqual([
      "#111111",
      "#222222",
    ]);
  });

  it("refuses a zip that holds no PNG", async () => {
    const emptyZip = buildStoredZipArchiveBytes([
      { name: "readme.txt", bytes: new TextEncoder().encode("no masks here") },
    ]);
    const api = createFakeImportApi([{ fileName: "masks.zip", bytes: emptyZip }]);

    await expect(importMaskLayerThroughOpenDialog(STACK, api)).rejects.toThrow(
      ZIP_WITHOUT_MASK_PNGS_MESSAGE,
    );
  });

  it("turns several picked PNGs into one layer with a category per file", async () => {
    const api = createFakeImportApi([
      await buildMaskPngFile({ fileName: "text.png", values: [1, 1, 0, 0, 0, 0, 0, 0] }),
      await buildMaskPngFile({ fileName: "parchment.png", values: [1, 0, 0, 0, 255, 255, 0, 0] }),
    ]);

    const result = await importMaskLayerThroughOpenDialog(STACK, api);

    expect(result.canceled).toBe(false);
    if (result.canceled) return;
    expect(result.content.name).toBe(COMBINED_MASK_LAYER_NAME);
    expect(result.content.categories.map((category) => category.name)).toEqual([
      "text",
      "parchment",
    ]);
    // The first pixel is labeled by both files, so the LAST file wins it.
    expect(Array.from(result.content.values)).toEqual([2, 1, 0, 0, 2, 2, 0, 0]);
  });

  it("names the offending file when one of several PNGs misses the stack", async () => {
    const api = createFakeImportApi([
      await buildMaskPngFile({ fileName: "text.png", values: [1, 1, 0, 0, 0, 0, 0, 0] }),
      await buildMaskPngFile({
        fileName: "wrong-size.png",
        width: 8,
        height: 8,
        values: new Array(64).fill(0),
      }),
    ]);

    await expect(importMaskLayerThroughOpenDialog(STACK, api)).rejects.toThrow(
      "wrong-size.png: This mask is 8 x 8 but the stack is 4 x 2.",
    );
  });

  it("refuses more picked files than a layer has categories before reading any", async () => {
    const files = await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        buildMaskPngFile({ fileName: `class-${index}.png`, values: [0, 0, 0, 0, 0, 0, 0, 0] }),
      ),
    );
    const api = createFakeImportApi(files);

    await expect(importMaskLayerThroughOpenDialog(STACK, api)).rejects.toThrow(
      "Select at most 5 mask files, one per category.",
    );
    expect(api.readOpenedImageFile).not.toHaveBeenCalled();
  });
});

// CT-332: the same picker, adding each picked PNG as a CATEGORY of the layer
// already on the panel instead of building a new layer.
describe("addMaskCategoriesFromFilesThroughOpenDialog", () => {
  it("appends a category per picked PNG, named after its file", async () => {
    const api = createFakeImportApi([
      await buildMaskPngFile({ fileName: "gold leaf.png", values: [0, 0, 255, 0, 0, 0, 0, 0] }),
    ]);

    const added = await addMaskCategoriesFromFilesThroughOpenDialog(buildTwoCategoryLayer(), api);

    expect(added.canceled).toBe(false);
    if (added.canceled) return;
    expect(added.layer.categories.map((category) => category.name)).toEqual([
      "Parchment",
      "Substrate",
      "gold leaf",
    ]);
    expect(Array.from(added.layer.values)).toEqual([0, 1, 3, 0, 2, 2, 0, 0]);
  });

  it("reports a cancelled dialog without touching the layer", async () => {
    const api = createCanceledImportApi();

    expect(await addMaskCategoriesFromFilesThroughOpenDialog(buildTwoCategoryLayer(), api)).toEqual({
      canceled: true,
    });
    expect(api.readOpenedImageFile).not.toHaveBeenCalled();
  });

  it("refuses a picked zip and points at the Import mask button", async () => {
    const api = createFakeImportApi([await buildExportedMaskZipFile()]);

    await expect(
      addMaskCategoriesFromFilesThroughOpenDialog(buildTwoCategoryLayer(), api),
    ).rejects.toThrow(MASK_CATEGORY_FROM_ZIP_MESSAGE);
    expect(api.readOpenedImageFile).not.toHaveBeenCalled();
  });

  it("refuses more picked files than the layer has free category slots", async () => {
    const files = await Promise.all(
      Array.from({ length: 4 }, (_unused, index) =>
        buildMaskPngFile({ fileName: `class-${index}.png`, values: [1, 0, 0, 0, 0, 0, 0, 0] }),
      ),
    );

    await expect(
      addMaskCategoriesFromFilesThroughOpenDialog(buildTwoCategoryLayer(), createFakeImportApi(files)),
    ).rejects.toThrow("This layer has 2 categories; pick at most 3 files.");
  });

  it("refuses a picked file whose grid does not cover the stack, naming it", async () => {
    const api = createFakeImportApi([
      await buildMaskPngFile({
        fileName: "wrong-size.png",
        width: 8,
        height: 8,
        values: new Array(64).fill(0),
      }),
    ]);

    await expect(
      addMaskCategoriesFromFilesThroughOpenDialog(buildTwoCategoryLayer(), api),
    ).rejects.toThrow("wrong-size.png: This mask is 8 x 8 but the stack is 4 x 2.");
  });
});
