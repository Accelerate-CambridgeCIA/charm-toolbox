import { expect, test } from "@playwright/test";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { colorfulNonClearPixelFraction } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  closeMasksOptions,
  createMaskLayer,
  createTemporaryExportDirectory,
  enableMaskEraser,
  exportSelectedMaskAndDecodeIndexPng,
  loadFixtureAsStack,
  maskEraserToggle,
  openMasksOptions,
  paintMaskDotAtPagePoint,
  pagePointForImagePixelCenter,
  paintMaskStrokeBetweenPixels,
  panelCanvas,
  panelCanvasCenter,
  readPixelValueAt,
  readReadoutAtPagePoint,
  selectMaskBrushCategory,
  selectPanel,
  setMaskBrushSizeToOnePixel,
  toggleMaskOverlayVisibility,
  wheelAtPagePoint,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-304: freehand mask painting on multiband-12bit.tif (4x4 uint16). The
// oracles, one per claim the story makes:
//   - the overlay is really on screen: colorfulNonClearPixelFraction of the
//     panel canvas, which reads ~0 for this dark 12-bit stack until a category
//     colour is painted over it;
//   - the DATA is untouched: the status-bar pixel readout at the painted pixel
//     still reports the value it reported before the stroke;
//   - the right pixels carry the right category: the CT-303 export flow writes
//     the mask out and a reference decoder reads the zip's index PNG back
//     sample-for-sample in this spec.
// The brush is set to 1 image pixel so a drag between two pixel CENTRES paints
// exactly those pixels. The zoom case cannot use the fit-view mapping at all,
// so it asks the READOUT which pixel sits under the cursor and then paints
// there, which is the "strokes respect zoom and pan" claim stated directly.

const PANEL = 1;
const IMAGE = { width: multiBandTiff.width, height: multiBandTiff.height };
const PAINTED_PIXEL = { x: 1, y: 1 };
const STROKE_END_PIXEL = { x: 2, y: 1 };
// Two of the 4x4 stack's sixteen pixels carry the tint, and this dark 12-bit
// stack contributes almost no non-clear pixels of its own, so the coloured
// share lands far above this floor - and a silently missing overlay reads 0.
const MINIMUM_TINTED_FRACTION = 0.05;
const WHEEL_STEP_DELTA = 240;

function buildExpectedMaskValues(painted: ReadonlyMap<number, number>): ReadonlyArray<number> {
  const values = new Array<number>(IMAGE.width * IMAGE.height).fill(0);
  for (const [index, value] of painted) values[index] = value;
  return values;
}

function pixelIndexOf(x: number, y: number): number {
  return y * IMAGE.width + x;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("paints a stroke that tints the panel without changing the data underneath", async () => {
  const page = launched.window;
  const canvas = panelCanvas(page, PANEL);

  const valueBeforePainting = await readPaintedPixelValue(page);
  const colourBeforePainting = await colorfulNonClearPixelFraction(canvas);

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);
  await paintMaskStrokeBetweenPixels(page, PANEL, PAINTED_PIXEL, STROKE_END_PIXEL, IMAGE);

  await runAsStoryboardStep(page, "Check the overlay tinted the panel", async () => {
    await expect
      .poll(() => colorfulNonClearPixelFraction(canvas))
      .toBeGreaterThan(Math.max(colourBeforePainting, MINIMUM_TINTED_FRACTION));
  });
  await runAsStoryboardStep(page, "Check the data under the stroke is unchanged", async () => {
    expect(await readPaintedPixelValue(page)).toBe(valueBeforePainting);
  });

  await expectExportedMaskValues(
    page,
    buildExpectedMaskValues(
      new Map([
        [pixelIndexOf(PAINTED_PIXEL.x, PAINTED_PIXEL.y), 1],
        [pixelIndexOf(STROKE_END_PIXEL.x, STROKE_END_PIXEL.y), 1],
      ]),
    ),
  );
});

test("paints the chosen category and erases it back to unlabeled", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);
  await selectMaskBrushCategory(page, 2);
  await paintMaskStrokeBetweenPixels(page, PANEL, PAINTED_PIXEL, STROKE_END_PIXEL, IMAGE);

  await enableMaskEraser(page);
  await paintMaskStrokeBetweenPixels(page, PANEL, STROKE_END_PIXEL, STROKE_END_PIXEL, IMAGE);

  await expectExportedMaskValues(
    page,
    buildExpectedMaskValues(new Map([[pixelIndexOf(PAINTED_PIXEL.x, PAINTED_PIXEL.y), 2]])),
  );
});

// CT-329: clicking the already-armed category while the eraser is on must
// re-arm painting with it in one click, not require picking a different
// category first. Painting category 1, then eraser, then category 1 again
// (no other category in between) must resume painting category 1.
test("clicking the same category after the eraser re-arms painting with it", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);
  await selectMaskBrushCategory(page, 1);
  await paintMaskStrokeBetweenPixels(page, PANEL, PAINTED_PIXEL, PAINTED_PIXEL, IMAGE);

  await enableMaskEraser(page);
  await selectMaskBrushCategory(page, 1);
  await runAsStoryboardStep(page, "The eraser toggle is no longer pressed", async () => {
    await expect(maskEraserToggle(page)).toHaveAttribute("aria-pressed", "false");
  });
  await paintMaskStrokeBetweenPixels(page, PANEL, STROKE_END_PIXEL, STROKE_END_PIXEL, IMAGE);

  await expectExportedMaskValues(
    page,
    buildExpectedMaskValues(
      new Map([
        [pixelIndexOf(PAINTED_PIXEL.x, PAINTED_PIXEL.y), 1],
        [pixelIndexOf(STROKE_END_PIXEL.x, STROKE_END_PIXEL.y), 1],
      ]),
    ),
  );
});

test("paints the pixel under the cursor after the view is zoomed in", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);

  const center = await panelCanvasCenter(page, PANEL);
  const pixelAtCentreBeforeZoom = await readReadoutAtPagePoint(page, center);
  // Zooming anchored on the stack's first pixel drags a DIFFERENT image pixel
  // under the canvas centre, so a brush that ignored the view transform would
  // paint the pre-zoom pixel and fail the export assertion.
  const zoomAnchor = await pagePointForImagePixelCentre(page, { x: 0, y: 0 });
  await wheelAtPagePoint(page, zoomAnchor, -WHEEL_STEP_DELTA, 3);
  // readReadoutAtPagePoint settles on the point one pixel right of the one it
  // is given, so that is the point the dot has to land on.
  const readout = await readReadoutAtPagePoint(page, center);
  expect([readout.imageX, readout.imageY]).not.toEqual([
    pixelAtCentreBeforeZoom.imageX,
    pixelAtCentreBeforeZoom.imageY,
  ]);
  await paintMaskDotAtPagePoint(page, { x: center.x + 1, y: center.y });

  await expectExportedMaskValues(
    page,
    buildExpectedMaskValues(new Map([[pixelIndexOf(readout.imageX, readout.imageY), 1]])),
  );
});

// The brush ghost: hovering with the Masks tool active outlines the exact
// footprint a click would paint, BEFORE any button is pressed. At brush size 1
// the footprint is a single image pixel, so the ghost's box must span the
// distance between adjacent pixel centres and centre itself on the hovered
// pixel. Without the tool, hovering shows nothing.
test("shows a ghost of the brush footprint under the cursor before painting", async () => {
  const page = launched.window;
  const ghost = page.getByTestId("mask-brush-ghost");
  const hoverPoint = await pagePointForImagePixelCentre(page, PAINTED_PIXEL);

  await runAsStoryboardStep(page, "Hover without the Masks tool: no ghost", async () => {
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await expect(ghost).toHaveCount(0);
  });

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);

  await runAsStoryboardStep(page, "Hover with the tool active: the ghost appears", async () => {
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await expect(ghost).toBeVisible();
  });

  await runAsStoryboardStep(page, "The ghost outlines exactly one image pixel", async () => {
    const neighbourPoint = await pagePointForImagePixelCentre(page, STROKE_END_PIXEL);
    const pixelSpanOnScreen = neighbourPoint.x - hoverPoint.x;
    const box = await ghost.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - pixelSpanOnScreen)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.x + box!.width / 2 - hoverPoint.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.y + box!.height / 2 - hoverPoint.y)).toBeLessThanOrEqual(2);
  });
});

// CT-344: painting is claimed by the brush ONLY while the Masks tool is
// active on a panel whose overlay is visible. Closing the tool or hiding the
// overlay while it stays open must each turn a centred click into a no-op,
// even though the overlay itself keeps rendering the painted layer.
test("stops painting while the Masks tool is closed or the panel's overlay is hidden", async () => {
  const page = launched.window;
  const canvas = panelCanvas(page, PANEL);

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);
  await paintMaskStrokeBetweenPixels(page, PANEL, PAINTED_PIXEL, PAINTED_PIXEL, IMAGE);
  const centrePoint = await panelCanvasCenter(page, PANEL);
  const exportDirectory = await createTemporaryExportDirectory();
  const valuesBeforeClosing = (
    await exportSelectedMaskAndDecodeIndexPng(page, join(exportDirectory, "before-closing.zip"))
  ).values;

  await runAsStoryboardStep(page, "Closing the Masks tool leaves the overlay on screen", async () => {
    await closeMasksOptions(page);
    await expect
      .poll(() => colorfulNonClearPixelFraction(canvas))
      .toBeGreaterThan(MINIMUM_TINTED_FRACTION);
  });

  await runAsStoryboardStep(page, "A centred click with the tool closed paints nothing", async () => {
    await paintMaskDotAtPagePoint(page, centrePoint);
    await openMasksOptions(page);
    await waitForMaskToastsToClear(page);
    const decoded = await exportSelectedMaskAndDecodeIndexPng(
      page,
      join(exportDirectory, "after-closed-tool-click.zip"),
    );
    expect(decoded.values).toEqual(valuesBeforeClosing);
  });

  await runAsStoryboardStep(page, "Hiding the overlay disables the brush ghost", async () => {
    await toggleMaskOverlayVisibility(page, PANEL);
    await page.mouse.move(centrePoint.x, centrePoint.y);
    await expect(page.getByTestId("mask-brush-ghost")).toHaveCount(0);
  });

  await runAsStoryboardStep(page, "A centred click with the overlay hidden paints nothing", async () => {
    await paintMaskDotAtPagePoint(page, centrePoint);
    await toggleMaskOverlayVisibility(page, PANEL);
    await waitForMaskToastsToClear(page);
    const decoded = await exportSelectedMaskAndDecodeIndexPng(
      page,
      join(exportDirectory, "after-hidden-overlay-click.zip"),
    );
    expect(decoded.values).toEqual(valuesBeforeClosing);
  });
});

async function pagePointForImagePixelCentre(
  page: Page,
  pixel: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  return pagePointForImagePixelCenter(page, PANEL, pixel, IMAGE);
}

async function readPaintedPixelValue(page: Page): Promise<string> {
  const readout = await readPixelValueAt(page, PANEL, PAINTED_PIXEL.x, PAINTED_PIXEL.y, IMAGE);
  return readout.value;
}

async function expectExportedMaskValues(
  page: Page,
  expectedValues: ReadonlyArray<number>,
): Promise<void> {
  const exportPath = join(await createTemporaryExportDirectory(), "painted-mask.zip");
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);
  expect(decoded.values).toEqual([...expectedValues]);
}

// A prior export's transient success toast can still be on screen when a test
// exports a second time, and its text ("Saved mask to <path>") makes every
// export toast match the same substring filter - so the next export's own
// wait for that toast resolves to more than one element. Let the earlier
// toast clear first.
async function waitForMaskToastsToClear(page: Page): Promise<void> {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
}
