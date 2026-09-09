import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import sharp from "sharp";

import { enqueueOpenDialogPaths, enqueueSaveDialogPath } from "./dialog-stub-controls";
import { masksOptionsPanel } from "./masks-panel";
import { runAsStoryboardStep } from "./storyboard-step";
import { readZipEntriesByName } from "./zip-archive";

// CT-303: the Masks aside's Import/Export row. Import picks mask files through
// the stubbed open dialog (a PNG's JSON sidecar, if any, is found by name in
// main; CT-328 allows several PNGs or one zip in a single pick);
// CT-327: Export writes the SELECTED layer's zip - a black-and-white PNG per
// category plus the index PNG and its sidecar - to the stubbed save path.

export function importMaskButton(page: Page): Locator {
  return masksOptionsPanel(page).getByRole("button", { name: "Import mask", exact: true });
}

export function exportMaskButton(page: Page): Locator {
  return masksOptionsPanel(page).getByRole("button", { name: "Export mask", exact: true });
}

export async function importMaskFromPath(page: Page, maskFilePath: string): Promise<void> {
  await runAsStoryboardStep(page, `Import the mask at ${maskFilePath}`, async () => {
    await enqueueOpenDialogPaths(page, [maskFilePath]);
    await importMaskButton(page).click();
  });
}

// CT-328: the picker is a multi-selection, so several PNGs (one category per
// file, in pick order) or one zip go through the SAME button.
export async function importMasksFromPaths(
  page: Page,
  maskFilePaths: ReadonlyArray<string>,
): Promise<void> {
  await runAsStoryboardStep(page, `Import ${maskFilePaths.length} mask files at once`, async () => {
    await enqueueOpenDialogPaths(page, maskFilePaths);
    await importMaskButton(page).click();
  });
}

// CT-332: "Add category from file" is the second picker in the aside; it adds
// every picked PNG as a category of the SELECTED layer instead of a new layer.
export function addMaskCategoryFromFileButton(page: Page): Locator {
  return masksOptionsPanel(page).getByRole("button", {
    name: "Add category from file",
    exact: true,
  });
}

export async function addMaskCategoriesFromPaths(
  page: Page,
  maskFilePaths: ReadonlyArray<string>,
): Promise<void> {
  const label = `Add a category from each of ${maskFilePaths.length} picked files`;
  await runAsStoryboardStep(page, label, async () => {
    await enqueueOpenDialogPaths(page, maskFilePaths);
    await addMaskCategoryFromFileButton(page).click();
  });
}

export async function exportSelectedMaskToZipPath(
  page: Page,
  destinationPath: string,
): Promise<void> {
  await runAsStoryboardStep(page, `Export the selected mask to ${destinationPath}`, async () => {
    await enqueueSaveDialogPath(page, destinationPath);
    await exportMaskButton(page).click();
    await expect(maskToastContaining(page, "Saved mask to")).toBeVisible();
  });
}

export function maskToastContaining(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

// The oracle every mask spec shares: export the selected layer and read the
// zip's INDEX PNG back with a reference decoder, so an assertion is about the
// category indexes really written to disk, not about anything on screen.
export interface DecodedMaskIndexPng {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly values: ReadonlyArray<number>;
}

export async function exportSelectedMaskAndDecodeIndexPng(
  page: Page,
  destinationZipPath: string,
): Promise<DecodedMaskIndexPng> {
  await exportSelectedMaskToZipPath(page, destinationZipPath);
  return runAsStoryboardStep(page, "Decode the exported mask zip in Node", () =>
    decodeIndexPngInsideMaskZip(destinationZipPath),
  );
}

// The index PNG is the entry sharing its stem with the JSON sidecar; the other
// PNGs are the per-category binaries. That is the same rule CT-328's importer
// uses, so the spec never has to know the layer's own name.
export async function decodeIndexPngInsideMaskZip(
  archivePath: string,
): Promise<DecodedMaskIndexPng> {
  const entries = await readZipEntriesByName(archivePath);
  const stem = findMaskZipSidecarStemOrThrow(entries);
  const indexPng = entries.get(`${stem}.png`);
  if (!indexPng) throw new Error(`${archivePath} has no index PNG named ${stem}.png.`);
  return decodeSingleChannelPngBuffer(indexPng);
}

export function findMaskZipSidecarStemOrThrow(entries: ReadonlyMap<string, Buffer>): string {
  const sidecarName = Array.from(entries.keys()).find((name) => name.endsWith(".json"));
  if (sidecarName === undefined) throw new Error("The mask zip holds no JSON sidecar.");
  return sidecarName.slice(0, -".json".length);
}

// sharp's default pipeline converts to 3-channel sRGB; "b-w" keeps the single
// 8-bit channel whose samples ARE the mask's values.
export async function decodeSingleChannelPngBuffer(
  pngBytes: Buffer,
): Promise<DecodedMaskIndexPng> {
  const decoded = await sharp(pngBytes)
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: decoded.info.width,
    height: decoded.info.height,
    channels: decoded.info.channels,
    values: Array.from(decoded.data),
  };
}
