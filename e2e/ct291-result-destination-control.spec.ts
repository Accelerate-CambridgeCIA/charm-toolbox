import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  cancelOperation,
  loadFixtureAsStack,
  openOperation,
  openSubsetBandsEditor,
  readPixelValueAt,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-291: the CT-277 "Open in a new panel" switch (and its off-state helper
// text) is replaced by a two-option segmented control labeled "Result" ("New
// panel" / "Replace panel"), rendered at both sites it always was: the
// tool-options panel footer and the Subset Bands editor. The underlying
// boolean state plumbing and the default (New panel) are unchanged.
//
// Fixture: multiband-12bit.tif (4x4, 3 bands uint16; pixel (0,0) band 1 = 100).
// Oracle: Invert on bounded uint16 data is a photographic-negative reflection
// (out = 65535 - in), so selecting "Replace panel" and applying must
// flip the SOURCE panel's readout to exactly 65535 - 100 via the pixel-readout
// oracle.

const INVERT = "Invert";
const PANEL = 1;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const SAMPLE_PIXEL = multiBandTiff.samplePixels[0]!;
const UINT16_MAX = 65535;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("both Result options render in a tool panel and in Subset Bands", async () => {
  const page = launched.window;

  await runAsStoryboardStep(page, "The tool-options panel offers both Result options", async () => {
    const panel = await openOperation(page, INVERT);
    await expectResultSegmentsRenderWithin(panel);
    await cancelOperation(page, INVERT);
  });

  await runAsStoryboardStep(page, "The Subset Bands editor offers both Result options", async () => {
    const editor = await openSubsetBandsEditor(page);
    await expectResultSegmentsRenderWithin(editor);
  });
});

test("selecting Replace panel and applying replaces the source panel", async () => {
  const page = launched.window;

  await openOperation(page, INVERT);
  await applyOperationInPlace(page, INVERT);

  const readout = await readPixelValueAt(page, PANEL, SAMPLE_PIXEL.x, SAMPLE_PIXEL.y, DIMENSIONS);
  expect(readout.value).toBe(String(UINT16_MAX - SAMPLE_PIXEL.valuesPerBand[0]!));
});

async function expectResultSegmentsRenderWithin(container: Locator): Promise<void> {
  await expect(container.getByRole("radio", { name: "New panel" })).toBeVisible();
  await expect(container.getByRole("radio", { name: "Replace panel" })).toBeVisible();
}
