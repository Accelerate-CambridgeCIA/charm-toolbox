import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { fixturePath, maskMultibandPng, multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  cancelOperation,
  closeMasksOptions,
  cnrOptionsPanel,
  CNR_PANEL_LABEL,
  expectMasksToolActive,
  importMaskFromPath,
  loadFixtureAsStack,
  maskLayerOptions,
  masksOptionsPanel,
  npcOptionsPanel,
  NPC_PANEL_LABEL,
  openMasksOptions,
  openOperation,
  operationPanel,
  ropOptionsPanel,
  ROP_PANEL_LABEL,
  selectPanel,
} from "./support/page-objects";
import { THRESHOLD_OPERATION_LABEL } from "./support/threshold-editor";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-345: the operation panel and the NPC / CNR / ROP / Masks asides share one
// right-side slot, so opening any of them closes every other one instead of
// hiding behind it. The oracles are the asides' own locator COUNTS (each aside
// unmounts when closed), the toolbar Masks button's aria-pressed for the tool
// state, and the Masks layer list for "closing the tool kept the mask data".
// The stack is multiband-12bit.tif with mask-multiband.png imported, so NPC and
// CNR both qualify and open a working aside rather than a blocked one.

const PANEL = 1;
const MASK_LAYER_COUNT = 1;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await importTheParchmentMask(launched.window);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("opening any right-side panel closes every other one", async () => {
  const page = launched.window;

  await runAsStoryboardStep(page, "An operation panel closes the NPC aside", async () => {
    await openOperation(page, NPC_PANEL_LABEL);
    await expect(npcOptionsPanel(page)).toBeVisible();
    await openOperation(page, THRESHOLD_OPERATION_LABEL);
    await expect(npcOptionsPanel(page)).toHaveCount(0);
    await expect(operationPanel(page, THRESHOLD_OPERATION_LABEL)).toBeVisible();
  });

  await runAsStoryboardStep(page, "Cancelling it does not bring the NPC aside back", async () => {
    await cancelOperation(page, THRESHOLD_OPERATION_LABEL);
    await expect(npcOptionsPanel(page)).toHaveCount(0);
  });

  await runAsStoryboardStep(page, "The CNR aside closes the Masks tool", async () => {
    await openMasksOptions(page);
    await expectMasksToolActive(page, true);
    await openOperation(page, CNR_PANEL_LABEL);
    await expect(masksOptionsPanel(page)).toHaveCount(0);
    await expectMasksToolActive(page, false);
  });

  await runAsStoryboardStep(page, "Reopening Masks still lists the imported layer", async () => {
    await openMasksOptions(page);
    await expect(cnrOptionsPanel(page)).toHaveCount(0);
    await expect(maskLayerOptions(page)).toHaveCount(MASK_LAYER_COUNT);
  });

  await runAsStoryboardStep(page, "The NPC aside closes the ROP aside", async () => {
    await openOperation(page, ROP_PANEL_LABEL);
    await expect(masksOptionsPanel(page)).toHaveCount(0);
    await openOperation(page, NPC_PANEL_LABEL);
    await expect(ropOptionsPanel(page)).toHaveCount(0);
    await expect(npcOptionsPanel(page)).toBeVisible();
  });
});

async function importTheParchmentMask(page: Page): Promise<void> {
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await expect(maskLayerOptions(page)).toHaveCount(MASK_LAYER_COUNT);
  await closeMasksOptions(page);
}
