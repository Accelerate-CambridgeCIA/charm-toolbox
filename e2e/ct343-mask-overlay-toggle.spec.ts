import { expect, test } from "@playwright/test";
import { join } from "node:path";

import { lowContrastGrayPng } from "./fixtures/fixture-manifest";
import { colorfulNonClearPixelFraction } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  clickPanelToSelect,
  createMaskLayer,
  createTemporaryProjectBundleDirectory,
  expectMaskOverlayToggleEnabled,
  loadFixtureAsStack,
  openMasksOptions,
  openProjectBundleThroughOpenDialog,
  paintMaskStrokeBetweenPixels,
  panelCanvas,
  readPixelValueAt,
  saveProjectBundleThroughSaveDialog,
  selectPanel,
  setMaskBrushSizeToOnePixel,
  toggleMaskOverlayVisibility,
  viewportMaskOverlay,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-343: the header "Show masks" toggle hides and shows a panel's mask
// overlay without touching the Masks tool or panel selection. Oracle for the
// tint is colorfulNonClearPixelFraction on the whole PANEL canvas, the
// masks-brush.spec.ts pattern: this grayscale fixture contributes no colour of
// its own (CT-159 grayscale renders as R==G==B), so a painted stroke lifts the
// fraction far above the floor and a hidden overlay (whose canvas unmounts
// entirely, per viewport-mask-overlay.tsx) reads back down below it. aria-pressed
// on the toggle button and the status-bar pixel readout at the painted pixel
// are the other two oracles - the toggle must never move the data.

const PANEL = 1;
const SECOND_PANEL = 2;
const IMAGE = { width: lowContrastGrayPng.width, height: lowContrastGrayPng.height };
const PAINTED_PIXEL = { x: 1, y: 1 };
const MINIMUM_TINTED_FRACTION = 0.05;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, lowContrastGrayPng.fileName);
  await loadFixtureAsStack(launched.window, lowContrastGrayPng.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("shows and hides a panel's mask overlay without moving the data or the selection", async () => {
  const page = launched.window;
  const canvas = panelCanvas(page, PANEL);

  await clickPanelToSelect(page, PANEL);
  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);
  await paintMaskStrokeBetweenPixels(page, PANEL, PAINTED_PIXEL, PAINTED_PIXEL, IMAGE);

  const readoutBeforeToggling = await readPixelValueAt(
    page,
    PANEL,
    PAINTED_PIXEL.x,
    PAINTED_PIXEL.y,
    IMAGE,
  );

  await runAsStoryboardStep(page, "The painted overlay starts visible", async () => {
    await expectMaskOverlayToggleEnabled(page, PANEL, true);
    await expect(viewportMaskOverlay(page, PANEL)).toHaveCount(1);
    await expect
      .poll(() => colorfulNonClearPixelFraction(canvas))
      .toBeGreaterThan(MINIMUM_TINTED_FRACTION);
  });

  await runAsStoryboardStep(page, "Clicking the toggle hides the overlay", async () => {
    await toggleMaskOverlayVisibility(page, PANEL);
    await expectMaskOverlayToggleEnabled(page, PANEL, false);
    await expect(viewportMaskOverlay(page, PANEL)).toHaveCount(0);
    await expect
      .poll(() => colorfulNonClearPixelFraction(canvas))
      .toBeLessThan(MINIMUM_TINTED_FRACTION);
  });

  await runAsStoryboardStep(page, "Clicking it again shows the overlay", async () => {
    await toggleMaskOverlayVisibility(page, PANEL);
    await expectMaskOverlayToggleEnabled(page, PANEL, true);
    await expect
      .poll(() => colorfulNonClearPixelFraction(canvas))
      .toBeGreaterThan(MINIMUM_TINTED_FRACTION);
  });

  await runAsStoryboardStep(page, "Selecting the other panel does not hide it", async () => {
    await clickPanelToSelect(page, SECOND_PANEL);
    await expect
      .poll(() => colorfulNonClearPixelFraction(canvas))
      .toBeGreaterThan(MINIMUM_TINTED_FRACTION);
  });

  await runAsStoryboardStep(page, "The underlying pixel data never changed", async () => {
    const readoutAfterToggling = await readPixelValueAt(
      page,
      PANEL,
      PAINTED_PIXEL.x,
      PAINTED_PIXEL.y,
      IMAGE,
    );
    expect(readoutAfterToggling.value).toBe(readoutBeforeToggling.value);
  });
});

test("a hidden overlay stays hidden after saving and reopening the project", async () => {
  const page = launched.window;

  await clickPanelToSelect(page, PANEL);
  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);
  await paintMaskStrokeBetweenPixels(page, PANEL, PAINTED_PIXEL, PAINTED_PIXEL, IMAGE);
  await toggleMaskOverlayVisibility(page, PANEL);
  await expectMaskOverlayToggleEnabled(page, PANEL, false);

  const bundlePath = join(await createTemporaryProjectBundleDirectory(), "hidden-overlay.ctbundle");
  await saveProjectBundleThroughSaveDialog({ app: launched.app, page, destinationPath: bundlePath });
  await openProjectBundleThroughOpenDialog({ app: launched.app, page, bundlePath });

  await selectPanel(page, PANEL);
  await runAsStoryboardStep(page, "The reopened panel restores the hidden overlay", async () => {
    await expectMaskOverlayToggleEnabled(page, PANEL, false);
    await expect(viewportMaskOverlay(page, PANEL)).toHaveCount(0);
    await expect
      .poll(() => colorfulNonClearPixelFraction(panelCanvas(page, PANEL)))
      .toBeLessThan(MINIMUM_TINTED_FRACTION);
  });
});
