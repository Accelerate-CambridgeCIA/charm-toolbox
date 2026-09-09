import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyCustomTransformAwaitingRun,
  clickImportCustomTransformScript,
  countPanels,
  CUSTOM_TRANSFORM_FORMULA_SET_STATUS,
  CUSTOM_TRANSFORM_OPERATION_LABEL,
  customTransformFailureToast,
  enqueueOpenDialogPaths,
  expectCustomTransformConfigured,
  expectCustomTransformEditorReady,
  expectCustomTransformPanelClosed,
  expectCustomTransformPanelStillOpen,
  expectCustomTransformShapeNoteVisible,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadedToolStatusText,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  selectPanel,
  setCustomTransformFormula,
  type PixelDimensions,
} from "./support/page-objects";

// The Custom transform runs a formula or imported tool over the WHOLE cube AT
// APPLY TIME: entering a formula or importing a .py only configures the panel
// (status line "Formula set..." / "Tool loaded: ..."), and Apply uploads the
// cube, runs the Python, and opens the returned cube as a new float32 stack
// in a fresh panel; the band count is free. The panel stays open across
// Apply, so a failed run can be corrected and re-applied without re-entering
// anything. multiband-12bit.tif (3 bands; at pixel (0,0) band 1 = 100, band 2
// = 800, band 3 = 1600) is the oracle: 'cube * 2' keeps 3 bands and reads 200
// at (0,0) on band 1; 'np.diff(cube, axis=0)' shrinks to 2 bands and reads
// 700; the imported transform-tool.py reverses the band order so band 1 reads
// 1600. Each case asserts the true value via the pixel-readout oracle.

const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const DIMENSIONS: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const FLOAT_READOUT_TOLERANCE = 0.1;
const DOUBLED_BAND_ONE_VALUE = 200;
const DIFF_BAND_ONE_VALUE = 800 - 100;
const REVERSED_BAND_ONE_VALUE = 1600;

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const IMPORTED_TRANSFORM_TOOL_PATH = join(currentDirectory, "fixtures", "transform-tool.py");

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, 1);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a configured formula runs at Apply and lands as a same-band-count stack", async () => {
  await openCustomTransformEditor();
  await setCustomTransformFormula(launched.window, "cube * 2");
  await expectCustomTransformConfigured(launched.window, CUSTOM_TRANSFORM_FORMULA_SET_STATUS);
  await applyCustomTransformAwaitingRun(launched.window);
  await expectTransformedOutput({
    expectedBandCount: 3,
    expectedTopLeftBandOneValue: DOUBLED_BAND_ONE_VALUE,
    historyDetailSubstring: "cube * 2",
  });
});

test("a formula changing the band count applies as a reduced stack", async () => {
  await openCustomTransformEditor();
  await setCustomTransformFormula(launched.window, "np.diff(cube, axis=0)");
  await applyCustomTransformAwaitingRun(launched.window);
  await expectTransformedOutput({
    expectedBandCount: 2,
    expectedTopLeftBandOneValue: DIFF_BAND_ONE_VALUE,
    historyDetailSubstring: "np.diff(cube, axis=0)",
  });
});

test("an imported .py tool only loads at import, runs at Apply, and is named in History", async () => {
  await openCustomTransformEditor();
  await enqueueOpenDialogPaths(launched.window, [IMPORTED_TRANSFORM_TOOL_PATH]);
  await clickImportCustomTransformScript(launched.window);
  await expectCustomTransformConfigured(
    launched.window,
    loadedToolStatusText("transform-tool.py"),
  );
  expect(await countPanels(launched.window)).toBe(1);
  await applyCustomTransformAwaitingRun(launched.window);
  await expectTransformedOutput({
    expectedBandCount: 3,
    expectedTopLeftBandOneValue: REVERSED_BAND_ONE_VALUE,
    historyDetailSubstring: "transform-tool.py",
  });
});

test("a failed run keeps the panel open with the formula set, and a corrected formula applies", async () => {
  await openCustomTransformEditor();
  await setCustomTransformFormula(launched.window, "cube +");
  await applyCustomTransformAwaitingRun(launched.window);
  await expect(customTransformFailureToast(launched.window)).toBeVisible();
  await expectCustomTransformPanelStillOpen(launched.window);
  await expectCustomTransformConfigured(launched.window, CUSTOM_TRANSFORM_FORMULA_SET_STATUS);
  await setCustomTransformFormula(launched.window, "cube * 2");
  await applyCustomTransformAwaitingRun(launched.window);
  await expectTransformedOutput({
    expectedBandCount: 3,
    expectedTopLeftBandOneValue: DOUBLED_BAND_ONE_VALUE,
    historyDetailSubstring: "cube * 2",
  });
});

test("a formula returning a spatial crop applies as a smaller-dimension stack", async () => {
  await openCustomTransformEditor();
  await setCustomTransformFormula(launched.window, "cube[:, 0:3, 0:2]");
  await applyCustomTransformAwaitingRun(launched.window);
  await expectCustomTransformPanelClosed(launched.window);
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: 2,
    height: 3,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe("3");
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: { width: 2, height: 3 },
    expected: 100,
    tolerance: 0.1,
  });
});

async function openCustomTransformEditor(): Promise<void> {
  await openOperation(launched.window, CUSTOM_TRANSFORM_OPERATION_LABEL);
  await expectCustomTransformEditorReady(launched.window);
}

interface ExpectedTransformedOutput {
  readonly expectedBandCount: number;
  readonly expectedTopLeftBandOneValue: number;
  readonly historyDetailSubstring: string;
}

async function expectTransformedOutput(expected: ExpectedTransformedOutput): Promise<void> {
  await expectCustomTransformPanelClosed(launched.window);
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectResultIsFloat32StackWithBandCount(expected.expectedBandCount);
  await expectResultReadout(expected.expectedTopLeftBandOneValue);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: CUSTOM_TRANSFORM_OPERATION_LABEL,
    detailSubstrings: [expected.historyDetailSubstring],
  });
}

async function expectResultIsFloat32StackWithBandCount(expectedBandCount: number): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(expectedBandCount));
}

async function expectResultReadout(expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: 0,
    imageY: 0,
    dimensions: DIMENSIONS,
    expected,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
}

// CT-349: Wallace read cube as (height, width, bands) and chased phantom bugs; the panel
// now states the band-major shape the scripting doc uses.
test("the panel names the cube shape as (bands, height, width)", async () => {
  await test.step("open Custom Transform", async () => {
    await openOperation(launched.window, CUSTOM_TRANSFORM_OPERATION_LABEL);
    await expectCustomTransformEditorReady(launched.window);
  });
  await test.step("the shape note is shown in the panel", async () => {
    await expectCustomTransformShapeNoteVisible(launched.window);
  });
});
