import { expect, test } from "@playwright/test";
import { join, parse } from "node:path";
import type { Page } from "@playwright/test";

import { bimodalGrayPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  createTemporaryExportDirectory,
  exportSelectedMaskAndDecodeIndexPng,
  exportSelectedStackThroughSaveDialog,
  importMaskFromPath,
  loadFixtureAsStack,
  maskCategoryNameFields,
  maskLayerNameField,
  maskLayerOptions,
  openMasksOptions,
  openOperation,
  selectPanel,
  setThresholdBoundField,
  THRESHOLD_OPERATION_LABEL,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-340: a Threshold result saved as PNG (8-bit) must round-trip into Masks
// import untouched. bimodal-gray.png's dark cluster (indexes 0-7, values
// 40-54) and bright cluster (indexes 8-15, values 200-214) sit around the
// manifest's pinned empty valley; a manual lower bound at that split (upper
// stays the uint8 default 255) leaves the dark cluster at 0 and the bright
// cluster at 255. mask-import.ts (CT-326) remaps the single non-zero value
// 255 to category 1, so the round trip should paint category 1 on exactly
// the bright cluster.

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const FIXTURE = bimodalGrayPng;
const SPLIT_LOWER_BOUND = FIXTURE.expectedOtsuCutoff;

const EXPECTED_MASK_VALUES = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1];

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, FIXTURE.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a threshold result saved as PNG (8-bit) imports as a one-category mask", async () => {
  const page = launched.window;

  await applyManualThresholdAtTheBimodalSplit(page);
  const exportedPngPath = await saveTheThresholdResultAsPng8(page);
  await importTheExportedPngAsAMaskOnTheSourcePanel(page, exportedPngPath);
  await expectTheImportedMaskCoversExactlyTheBrightCluster(page, exportedPngPath);
});

async function applyManualThresholdAtTheBimodalSplit(page: Page): Promise<void> {
  await runAsStoryboardStep(
    page,
    "Apply Threshold with manual bounds at the bimodal split",
    async () => {
      await openOperation(page, THRESHOLD_OPERATION_LABEL);
      await setThresholdBoundField(page, "Lower", SPLIT_LOWER_BOUND);
      await applyOperation(page, THRESHOLD_OPERATION_LABEL);
    },
  );
}

async function saveTheThresholdResultAsPng8(page: Page): Promise<string> {
  return runAsStoryboardStep(page, "Save the threshold result as PNG (8-bit)", async () => {
    await selectPanel(page, RESULT_PANEL);
    const exportPath = join(await createTemporaryExportDirectory(), "threshold-result.png");
    await exportSelectedStackThroughSaveDialog({
      app: launched.app,
      page,
      formatLabel: "PNG (8-bit)",
      destinationPath: exportPath,
    });
    return exportPath;
  });
}

async function importTheExportedPngAsAMaskOnTheSourcePanel(
  page: Page,
  exportedPngPath: string,
): Promise<void> {
  await runAsStoryboardStep(
    page,
    "Import the exported PNG as a mask on the original fixture panel",
    async () => {
      await selectPanel(page, SOURCE_PANEL);
      await openMasksOptions(page);
      await importMaskFromPath(page, exportedPngPath);
    },
  );
}

async function expectTheImportedMaskCoversExactlyTheBrightCluster(
  page: Page,
  exportedPngPath: string,
): Promise<void> {
  await runAsStoryboardStep(page, "Check the imported layer and its single category", async () => {
    await expect(maskLayerOptions(page)).toHaveCount(1);
    await expect(maskLayerNameField(page)).toHaveValue(parse(exportedPngPath).name);
    await expect(maskCategoryNameFields(page)).toHaveCount(1);
  });
  const exportPath = join(await createTemporaryExportDirectory(), "roundtrip-mask.zip");
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);
  expect(decoded.values).toEqual(EXPECTED_MASK_VALUES);
}
