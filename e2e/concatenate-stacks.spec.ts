import { test, expect } from "@playwright/test";

import { multiBandTiff, noisyGrayPng } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  isApplyEnabled,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  selectActiveBandNumberInPanel,
  selectPanel,
} from "./support/page-objects";
import {
  CONCATENATE_STACKS_LABEL,
  chooseLoadedPanelAsSecondStack,
  concatenateStacksSecondStackField,
} from "./support/concatenate-stacks-operation";
import { removeDisplayedBand } from "./support/band-management";
import { expectPanelHeaderActiveBand } from "./support/panel-header-label";

// CT-300: concatenate the active stack's bands with a second open stack of the
// same spatial dimensions, active bands first then the second stack's, values
// copied as-is. The second-stack picker offers ONLY dimension-matching loaded
// panels; when none qualifies, Apply stays disabled with a locked-vocabulary
// explanation.

const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const MULTIBAND_PANEL_2_OPTION = `Panel 2 (${multiBandTiff.fileName})`;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("concatenates two open stacks into a wider stack, active bands first", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 1);
  await openOperation(launched.window, CONCATENATE_STACKS_LABEL);
  await chooseLoadedPanelAsSecondStack(launched.window, MULTIBAND_PANEL_2_OPTION);
  await applyOperationInPlace(launched.window, CONCATENATE_STACKS_LABEL);

  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: "uint16",
    width: 4,
    height: 4,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe("6");

  await selectActiveBandNumberInPanel(launched.window, 1, 4);
  await expectPixelReadoutToEqual(launched.window, {
    panel: 1,
    imageX: 0,
    imageY: 0,
    dimensions: FOUR_BY_FOUR,
    expected: multibandCornerValue(0),
  });

  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: CONCATENATE_STACKS_LABEL,
    detailSubstrings: ["Panel 2"],
  });
});

test("renumbers bands sequentially after concatenation, so band removal targets the band shown", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 1);
  await openOperation(launched.window, CONCATENATE_STACKS_LABEL);
  await chooseLoadedPanelAsSecondStack(launched.window, MULTIBAND_PANEL_2_OPTION);
  await applyOperationInPlace(launched.window, CONCATENATE_STACKS_LABEL);

  await selectActiveBandNumberInPanel(launched.window, 1, 4);
  await expectPanelHeaderActiveBand(launched.window, 1, 4);
  await selectActiveBandNumberInPanel(launched.window, 1, 6);
  await expectPanelHeaderActiveBand(launched.window, 1, 6);

  await selectActiveBandNumberInPanel(launched.window, 1, 5);
  await removeDisplayedBand(launched.window, 5);

  await selectActiveBandNumberInPanel(launched.window, 1, 5);
  await expectPixelReadoutToEqual(launched.window, {
    panel: 1,
    imageX: 0,
    imageY: 0,
    dimensions: FOUR_BY_FOUR,
    expected: multibandCornerValue(2),
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe("5");
});

test("does not offer a source panel of a different size, and blocks Apply", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await loadFixtureAsStack(launched.window, noisyGrayPng.fileName);
  await selectPanel(launched.window, 1);
  await openOperation(launched.window, CONCATENATE_STACKS_LABEL);

  const field = concatenateStacksSecondStackField(launched.window);
  await expect(field.getByRole("button", { name: "Use a loaded panel..." })).toHaveCount(0);
  await expect(field.getByText("No open stack matches")).toBeVisible();
  await expect(await isApplyEnabled(launched.window, CONCATENATE_STACKS_LABEL)).toBe(false);
});

function multibandCornerValue(bandIndex: number): number {
  const value = multiBandTiff.samplePixels[0]?.valuesPerBand[bandIndex];
  if (value === undefined) throw new Error(`multiBandTiff (0,0) has no band ${bandIndex} value`);
  return value;
}
