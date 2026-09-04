import { expect, test } from "@playwright/test";

import { noisyGrayPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  applyOperationInPlace,
  drawInspectionRoiBetweenPixels,
  expectExactlyOneCommittedRoi,
  expectMetadataDataTypeAndDimensions,
  loadFixtureAsStack,
  openOperation,
  readRegionStats,
  selectOperationRegionByDrag,
  selectPanel,
} from "./support/page-objects";

// CT-348: a region drag whose end (or, canonicalized, start) point falls past
// the image edge clamps to the image boundary instead of committing nothing.
// Fixture noisy-gray.png (8x8, uint8). The out-of-range endpoints below are
// expressed as ImagePixel coordinates well outside 0..7 on purpose:
// pagePointForImagePixelCenter (the mapping drawInspectionRoiBetweenPixels and
// selectOperationRegionByDrag both use) extrapolates the fit-view projection
// linearly with no clamping of its own, so a pixel like (20, 20) lands a real
// page point comfortably beyond the panel's canvas - exactly like a user
// dragging their mouse off the image. Every drag here presses down on a VALID
// on-canvas pixel first (attachRoiDrawEventHandlers only starts a drag from a
// pointerdown that actually lands on the canvas) and then travels out past an
// edge; pointer capture keeps delivering the rest of the gesture to the canvas
// once it has started. Because canonicalizeViewportRoiCorners sorts the two
// corners regardless of which one was the press vs. the release, the
// committed box is identical to a drag that pressed down outside the edge.

const PANEL = 1;
const IMAGE_8X8 = { width: noisyGrayPng.width, height: noisyGrayPng.height };
const CROP = "Crop to Region";
const BEYOND_BOTTOM_RIGHT = { x: 20, y: 20 };
const BEYOND_TOP_LEFT = { x: -20, y: -20 };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, noisyGrayPng.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a drag past the bottom-right edge clamps the box to the last image pixel", async () => {
  const page = launched.window;

  await test.step("activate Select Region and drag past the bottom-right corner", async () => {
    await activateRegionTool(page);
    await drawInspectionRoiBetweenPixels(page, PANEL, { x: 2, y: 2 }, BEYOND_BOTTOM_RIGHT, IMAGE_8X8);
  });

  await test.step("the box clamps to the image's bottom-right pixel instead of vanishing", async () => {
    await expectExactlyOneCommittedRoi(page, PANEL);
    expect(await readRegionStats(page)).toEqual({ corners: "(2, 2) - (7, 7)", size: "6 x 6 px" });
  });
});

test("a drag past the top-left edge clamps the box to the first image pixel", async () => {
  const page = launched.window;

  await test.step("activate Select Region and drag past the top-left corner", async () => {
    await activateRegionTool(page);
    await drawInspectionRoiBetweenPixels(page, PANEL, { x: 3, y: 3 }, BEYOND_TOP_LEFT, IMAGE_8X8);
  });

  await test.step("the box clamps to the image's top-left pixel instead of vanishing", async () => {
    await expectExactlyOneCommittedRoi(page, PANEL);
    expect(await readRegionStats(page)).toEqual({ corners: "(0, 0) - (3, 3)", size: "4 x 4 px" });
  });
});

test("Crop to Region's own region-select drag also clamps past the edge", async () => {
  const page = launched.window;

  await test.step("open Crop to Region and drag its region past the bottom-right corner", async () => {
    await openOperation(page, CROP);
    await selectOperationRegionByDrag(page, {
      panelNumber: PANEL,
      operationLabel: CROP,
      startPixel: { x: 2, y: 2 },
      endPixel: BEYOND_BOTTOM_RIGHT,
      imageDimensions: IMAGE_8X8,
    });
  });

  await test.step("applying crops to the clamped 6x6 region", async () => {
    await applyOperationInPlace(page, CROP);
    await expectMetadataDataTypeAndDimensions(page, {
      dataType: noisyGrayPng.dataType,
      width: 6,
      height: 6,
    });
  });
});
