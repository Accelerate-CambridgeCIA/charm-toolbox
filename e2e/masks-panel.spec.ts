import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { maskMultibandPng, multiBandTiff, fixturePath } from "./fixtures/fixture-manifest";
import { colorfulNonClearPixelFraction } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addMaskCategoriesUntilTheControlDisables,
  addMaskCategoryButton,
  applyOperationInPlace,
  applyQuickGeometricTransform,
  clickPanelToSelect,
  createMaskLayer,
  createTemporaryExportDirectory,
  exportSelectedMaskAndDecodeIndexPng,
  importMaskFromPath,
  loadFixtureAsStack,
  maskCategoryNameField,
  maskCategoryNameFields,
  maskLayerOpacitySlider,
  maskLayerOptions,
  masksOptionsPanel,
  masksRemovedToast,
  MAX_MASK_CATEGORIES,
  openMasksOptions,
  openOperation,
  pagePointForImagePixelCenter,
  paintMaskDotAtPagePoint,
  readPixelValueAt,
  selectPanel,
  viewportMaskOverlay,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-302: mask layers annotate a stack's spatial grid. This spec drives the
// Masks options aside on multiband-12bit.tif (4x4, 3 bands): create a layer,
// rename a category, fill the category list to its cap of five, then check the
// two survival rules through REAL applies - a value operation (Invert, in
// place) leaves the layer alone, while a geometry change (Rotate 90 clockwise,
// in place) carries every layer through the SAME rotation, proven by exporting
// the rotated mask and decoding it in the spec. The 4x4 fixture is square on
// purpose: rotating it keeps the reported width and height, so only the
// operation's own geometry declaration can drive the mask reconciliation.

const PANEL = 1;
const INVERT = "Invert";
const FIRST_CATEGORY = 1;
const RENAMED_CATEGORY = "Parchment";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("creates a mask layer, renames a category, and caps the category list at five", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await expect(maskLayerOptions(page)).toHaveCount(0);

  await createMaskLayer(page);
  await expect(maskLayerOptions(page)).toHaveCount(1);
  await expect(maskCategoryNameFields(page)).toHaveCount(2);
  await expect(maskCategoryNameField(page, 1)).toHaveValue("Foreground");
  await expect(maskCategoryNameField(page, 2)).toHaveValue("Background");
  await expect(maskLayerOpacitySlider(page)).toHaveAttribute("aria-valuenow", "50");

  await maskCategoryNameField(page, FIRST_CATEGORY).fill(RENAMED_CATEGORY);
  await expect(maskCategoryNameField(page, FIRST_CATEGORY)).toHaveValue(RENAMED_CATEGORY);

  const categoryCount = await addMaskCategoriesUntilTheControlDisables(page);
  expect(categoryCount).toBe(MAX_MASK_CATEGORIES);
  await expect(addMaskCategoryButton(page)).toBeDisabled();
  await expect(maskCategoryNameField(page, FIRST_CATEGORY)).toHaveValue(RENAMED_CATEGORY);
});

test("keeps the panel's masks through an in-place value operation", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);
  await maskCategoryNameField(page, FIRST_CATEGORY).fill(RENAMED_CATEGORY);

  await openOperation(page, INVERT);
  await applyOperationInPlace(page, INVERT);

  // CT-345: opening the operation panel closes the Masks tool, so the aside is
  // gone by now; reopening it must still find the panel's untouched masks.
  await expect(masksOptionsPanel(page)).toHaveCount(0);
  await openMasksOptions(page);
  await expect(maskLayerOptions(page)).toHaveCount(1);
  await expect(maskCategoryNameField(page, FIRST_CATEGORY)).toHaveValue(RENAMED_CATEGORY);
  await expect(masksRemovedToast(page)).toHaveCount(0);
});

// The fixture mask paints row 0 with category 1 and row 3 with category 2, so
// rotating 90 clockwise must land category 2 in column 0 and category 1 in
// column 3: every row of the rotated mask reads [2, 0, 0, 1].
const ROTATED_MASK_ROW = [2, 0, 0, 1];
const EXPECTED_ROTATED_MASK_VALUES = [
  ...ROTATED_MASK_ROW,
  ...ROTATED_MASK_ROW,
  ...ROTATED_MASK_ROW,
  ...ROTATED_MASK_ROW,
];

test("rotates the panel's masks with an in-place apply that rotates the stack", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await expect(maskLayerOptions(page)).toHaveCount(1);

  await applyQuickGeometricTransform(page, "rotate-90-cw");

  await expect(masksRemovedToast(page)).toHaveCount(0);
  await expect(maskLayerOptions(page)).toHaveCount(1);

  const exportPath = join(await createTemporaryExportDirectory(), "rotated-mask.zip");
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);
  expect(decoded.values).toEqual(EXPECTED_ROTATED_MASK_VALUES);
});

const SECOND_PANEL = 2;
const IMAGE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

// CT-342: the overlay answers to the panel's OWN visibility flag, so two panels
// each carrying an imported layer both keep their mask on screen while only one
// of them is selected. Painting is still the selected panel's alone (CT-331), so
// a drag across the unselected panel leaves its mask exactly as imported. The
// oracles: colorfulNonClearPixelFraction on each overlay canvas (the imported
// mask tints half of this dark 12-bit stack in saturated category colours, and a
// missing overlay has no canvas to sample at all), and the exported index PNG,
// which must still read back the values the fixture was imported with.
const IMPORTED_MASK_VALUES = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2];
const MINIMUM_TINTED_OVERLAY_FRACTION = 0.05;
// A DOT, not a drag: an unselected panel does not claim the gesture, so a drag
// there would pan its view and move every later page point off its pixel. A
// zero-travel press still covers the whole 4x4 grid at the default brush size,
// so it is the stronger "did anything paint here?" probe anyway.
const UNSELECTED_PAINT_ATTEMPT_PIXEL = { x: 1, y: 1 };

test("keeps the overlay on an unselected panel and paints only the selected one", async () => {
  const page = launched.window;

  await loadFixtureAsStack(page, multiBandTiff.fileName);

  await openMasksOptions(page);
  await clickPanelToSelect(page, PANEL);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await expect(maskLayerOptions(page)).toHaveCount(1);

  await clickPanelToSelect(page, SECOND_PANEL);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await expect(maskLayerOptions(page)).toHaveCount(1);

  const panel1ReadoutBefore = await readPixelValueAt(page, PANEL, 0, 0, IMAGE_DIMENSIONS);
  const panel2ReadoutBefore = await readPixelValueAt(page, SECOND_PANEL, 0, 0, IMAGE_DIMENSIONS);

  await clickPanelToSelect(page, SECOND_PANEL);
  await runAsStoryboardStep(page, "Both panels still show their mask overlay", async () => {
    await expectPanelShowsATintedMaskOverlay(page, PANEL);
    await expectPanelShowsATintedMaskOverlay(page, SECOND_PANEL);
  });

  await paintMaskDotAtPagePoint(
    page,
    await pagePointForImagePixelCenter(
      page,
      PANEL,
      UNSELECTED_PAINT_ATTEMPT_PIXEL,
      IMAGE_DIMENSIONS,
    ),
  );

  const panel1ReadoutAfter = await readPixelValueAt(page, PANEL, 0, 0, IMAGE_DIMENSIONS);
  const panel2ReadoutAfter = await readPixelValueAt(page, SECOND_PANEL, 0, 0, IMAGE_DIMENSIONS);
  expect(panel1ReadoutAfter.value).toBe(panel1ReadoutBefore.value);
  expect(panel2ReadoutAfter.value).toBe(panel2ReadoutBefore.value);

  await clickPanelToSelect(page, PANEL);
  const exportPath = join(await createTemporaryExportDirectory(), "unpainted-mask.zip");
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);
  expect(decoded.values).toEqual(IMPORTED_MASK_VALUES);
});

async function expectPanelShowsATintedMaskOverlay(page: Page, panelNumber: number): Promise<void> {
  const overlay = viewportMaskOverlay(page, panelNumber);
  await expect(overlay).toBeVisible();
  await expect
    .poll(() => colorfulNonClearPixelFraction(overlay))
    .toBeGreaterThan(MINIMUM_TINTED_OVERLAY_FRACTION);
}
