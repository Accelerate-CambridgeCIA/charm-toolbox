import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  builtinScriptReferences,
  fixturePath,
  maskMultibandPng,
  multiBandTiff,
} from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  closeMasksOptions,
  computeNpcScores,
  expectScoreWithinRelativeTolerance,
  importMaskFromPath,
  loadFixtureAsStack,
  npcBinsField,
  npcComputeButton,
  npcMaskLayerPicker,
  npcOptionsPanel,
  npcScorePlot,
  npcScoresSection,
  NPC_NOT_COMPUTED_TEXT,
  NPC_PANEL_LABEL,
  openMasksOptions,
  openOperation,
  readHistoryEntries,
  selectPanel,
  setNpcBinCount,
  type NpcTopBandRowReadout,
} from "./support/page-objects";
import {
  CONCATENATE_STACKS_LABEL,
  chooseLoadedPanelAsSecondStack,
} from "./support/concatenate-stacks-operation";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-308: the NPC score. The stack is multiband-12bit.tif (4x4x3 uint16) and
// the labels come from importing mask-multiband.png, whose two categories are
// the top row and the bottom row.
//
// ORACLE: manifest.json's builtinScriptReferences, pinned by the CT-307
// reference runner executing the SAME packaged npc.py under the bundled Python
// runtime, outside the app. CT-318 scores every band on its own, so each
// reference is a LIST with one score per band; CT-319 reads every band of it
// back through the aside's "Top bands" list, which is sorted best first with
// ties broken by band order.

const PANEL = 1;
const MASK_LAYER_NAME = maskMultibandPng.name ?? "Parchment mask";
const DEFAULT_BINS = builtinScriptReferences.npc.params.bins;
const COARSE_BINS = builtinScriptReferences.npcCoarseBins.params.bins;
const FINE_BAND_SCORES = builtinScriptReferences.npc.value;
const COARSE_BAND_SCORES = builtinScriptReferences.npcCoarseBins.value;
const MAX_TOP_BAND_ROWS = 5;

// The panel shows a score to four significant figures, trailing zeros kept.
function formatScoreAsThePanelDoes(score: number): string {
  return score.toPrecision(4);
}

interface ExpectedTopBandRow {
  readonly bandIdentityText: string;
  readonly score: number;
}

function describeExpectedTopBandRows(
  scores: ReadonlyArray<number>,
): ReadonlyArray<ExpectedTopBandRow> {
  return scores
    .map((score, bandIndex) => ({ bandIdentityText: `Band ${bandIndex + 1}`, score, bandIndex }))
    .sort((left, right) => right.score - left.score || left.bandIndex - right.bandIndex)
    .slice(0, MAX_TOP_BAND_ROWS);
}

function describeExpectedHistoryDetail(bins: number, scores: ReadonlyArray<number>): string {
  const rows = describeExpectedTopBandRows(scores)
    .map((row) => `${row.bandIdentityText} ${formatScoreAsThePanelDoes(row.score)}`)
    .join(", ");
  return `NPC (${MASK_LAYER_NAME}, ${bins} bins): ${rows}`;
}

function expectTopBandRowsMatchReference(
  rows: ReadonlyArray<NpcTopBandRowReadout>,
  scores: ReadonlyArray<number>,
): void {
  const expected = describeExpectedTopBandRows(scores);
  expect(rows.map((row) => row.bandIdentityText)).toEqual(
    expected.map((row) => row.bandIdentityText),
  );
  rows.forEach((row, index) => {
    expectScoreWithinRelativeTolerance(Number(row.scoreText), expected[index]?.score ?? Number.NaN);
  });
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

test("plots every band's score, lists the top bands, and records each run in History", async () => {
  const page = launched.window;

  await importTheParchmentMask(page);
  await openOperation(page, NPC_PANEL_LABEL);
  await expectPanelDefaultsToTheImportedLayer(page);

  const fineRows = await computeNpcScores(page);
  expectTopBandRowsMatchReference(fineRows, FINE_BAND_SCORES);
  await expectThePlotIsOnScreen(page);

  await expectChangingTheBinsClearsTheResults(page, Number(COARSE_BINS));
  const coarseRows = await computeNpcScores(page);
  expectTopBandRowsMatchReference(coarseRows, COARSE_BAND_SCORES);

  await closeNpcOptions(page);
  await expectHistoryRecordsBothRuns(page);
});

test("lists top-band rows with no repeated label after concatenating a stack with itself", async () => {
  const page = launched.window;

  await loadFixtureAsStack(page, multiBandTiff.fileName);
  await selectPanel(page, PANEL);
  await openOperation(page, CONCATENATE_STACKS_LABEL);
  await chooseLoadedPanelAsSecondStack(page, `Panel 2 (${multiBandTiff.fileName})`);
  await applyOperationInPlace(page, CONCATENATE_STACKS_LABEL);

  await importTheParchmentMask(page);
  await openOperation(page, NPC_PANEL_LABEL);
  const rows = await computeNpcScores(page);

  const labels = rows.map((row) => row.bandIdentityText);
  expect(new Set(labels).size).toBe(labels.length);
});

test("keeps the controls disabled until a mask layer has two painted categories", async () => {
  const page = launched.window;

  await openOperation(page, NPC_PANEL_LABEL);
  await expectPanelBlockedWithAnExplanation(page);

  await closeNpcOptions(page);
  await importTheParchmentMask(page);
  await openOperation(page, NPC_PANEL_LABEL);

  await expect(npcComputeButton(page)).toBeEnabled();
  await expect(npcScoresSection(page)).toHaveText(NPC_NOT_COMPUTED_TEXT);
});

async function importTheParchmentMask(page: Page): Promise<void> {
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await closeMasksOptions(page);
}

async function closeNpcOptions(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Close the NPC options aside", async () => {
    await npcOptionsPanel(page).getByRole("button", { name: "Close NPC options" }).click();
    await expect(npcOptionsPanel(page)).toBeHidden();
  });
}

async function expectPanelDefaultsToTheImportedLayer(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the NPC panel's defaults", async () => {
    await expect(npcMaskLayerPicker(page)).toHaveValue(/.+/);
    await expect(npcMaskLayerPicker(page).locator("option")).toHaveText([MASK_LAYER_NAME]);
    await expect(npcBinsField(page)).toHaveValue(String(DEFAULT_BINS));
    await expect(npcScoresSection(page)).toHaveText(NPC_NOT_COMPUTED_TEXT);
    // A score is not a raster, so the panel offers no result destination.
    await expect(npcOptionsPanel(page).getByRole("button", { name: "Apply" })).toHaveCount(0);
  });
}

async function expectPanelBlockedWithAnExplanation(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the NPC panel with no mask layers", async () => {
    await expect(npcComputeButton(page)).toBeDisabled();
    await expect(npcMaskLayerPicker(page)).toBeDisabled();
    await expect(npcBinsField(page)).toBeDisabled();
    await expect(npcOptionsPanel(page)).toContainText("no mask layers");
  });
}

async function expectThePlotIsOnScreen(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "See the per-band score plot", async () => {
    await expect(npcScorePlot(page)).toBeVisible();
    await expect(npcScorePlot(page).getByRole("img", { name: "NPC per band plot" })).toBeVisible();
  });
}

async function expectChangingTheBinsClearsTheResults(page: Page, bins: number): Promise<void> {
  await setNpcBinCount(page, bins);
  await runAsStoryboardStep(page, "See the plot and list cleared by the new bin count", async () => {
    await expect(npcScoresSection(page)).toHaveText(NPC_NOT_COMPUTED_TEXT);
  });
}

async function expectHistoryRecordsBothRuns(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the two NPC entries in History", async () => {
    const entries = await readHistoryEntries(page);
    const npcEntries = entries.filter((entry) => entry.actionLabel === NPC_PANEL_LABEL);
    expect(npcEntries.map((entry) => entry.detailLines.join(" "))).toEqual([
      describeExpectedHistoryDetail(Number(DEFAULT_BINS), FINE_BAND_SCORES),
      describeExpectedHistoryDetail(Number(COARSE_BINS), COARSE_BAND_SCORES),
    ]);
  });
}
