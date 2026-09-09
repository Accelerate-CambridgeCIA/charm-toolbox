import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applySubsetBands,
  DUPLICATE_BANDS_OPERATION_LABEL,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openSubsetBandsDuplicateEditor,
  readMetadata,
  selectActiveBandNumberInPanel,
  selectPanel,
  setSubsetBandsOpenInNewPanel,
  type PixelDimensions,
  typeSubsetBandsDuplicateRange,
} from "./support/page-objects";
import { panelHeaderLabel } from "./support/panel-header-label";

// CT-301: the Subset Bands editor's "Duplicate" mode appends copies of the
// typed bands to the end of the stack. Duplicating band 1 of the 3-band
// multiband-12bit.tif (4x4, pixel (0,0) = [100, 800, 1600]) gives a 4-band
// stack whose new band 4 reads the same value as band 1.

const PANEL = 1;
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const BAND_ONE_VALUE = multiBandTiff.samplePixels[0]!.valuesPerBand[0]!;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("duplicates band 1 to the end of the stack, in place", async () => {
  const page = launched.window;

  await openSubsetBandsDuplicateEditor(page);
  await typeSubsetBandsDuplicateRange(page, "1");
  await setSubsetBandsOpenInNewPanel(page, false);
  await applySubsetBands(page);

  await expectMetadataDataTypeAndDimensions(page, {
    dataType: "uint16",
    width: DIMENSIONS.width,
    height: DIMENSIONS.height,
  });
  const metadata = await readMetadata(page);
  expect(metadata.bandCount).toBe("4");

  await selectActiveBandNumberInPanel(page, PANEL, 4);
  // CT-341: the duplicated band renumbers to its position (4), not the source
  // band's original number (1) it copied from.
  await expect(panelHeaderLabel(page, PANEL)).toHaveAttribute("title", /- #4 Band 1 copy$/);
  await expectPixelReadoutToEqual(page, {
    panel: PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected: BAND_ONE_VALUE,
  });

  await expectHistoryToRecordOperation(page, {
    actionLabel: DUPLICATE_BANDS_OPERATION_LABEL,
    detailSubstrings: ["Duplicate bands (1)"],
  });
});
