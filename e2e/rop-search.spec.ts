import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  builtinScriptReferences,
  fixturePath,
  maskMultibandPng,
  multiBandTiff,
} from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  chooseRopObjective,
  closeMasksOptions,
  countPanels,
  duplicateMenuItem,
  duplicatePanelViaContextMenu,
  enqueueOpenDialogPaths,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  importMaskFromPath,
  importRopObjectiveScript,
  loadFixtureAsStack,
  openMasksOptions,
  openOperation,
  panelCanvas,
  panelCell,
  panelGrid,
  pressNewProjectionUntilProjectionReady,
  readMetadata,
  ropOptionsPanel,
  ropProjectionCountField,
  ropSearchButton,
  ropSeedReadout,
  ROP_NO_CANDIDATE_TEXT,
  ROP_PANEL_LABEL,
  ROP_PRESS_REFUSED_TEXT,
  selectGridLayout,
  selectPanel,
  setRopProjectionCount,
  startRopProjectionSearch,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-310: the ROP optimization search. One built-in run loops every candidate
// in Python, scores each with the chosen objective, and only the winner comes
// back as a stack.
//
// FIXTURES: multiband-12bit.tif (4x4x3 uint16) labelled by mask-multiband.png
// (top row Parchment = category 1, bottom row Substrate = category 2), with the
// forced seed so the 50-candidate draw is the one pinned in the manifest.
//
// OBJECTIVE CHOICE: every band of multiband-12bit.tif is the same ramp at a
// different offset, so every projection is an affine transform of one ramp and
// every scale-invariant objective (CNR, NPC) scores all 50 candidates
// identically - the winner would be float noise. The committed
// mask-contrast-objective.py does not normalize by the spread, so the scores
// really differ; it also exercises the story's custom-objective path, whose
// SOURCE the app sends into the search to be evaluated per candidate.
//
// ORACLES, one per claim:
//   - the delivered stack IS the pinned winner: every pixel of
//     builtinScriptReferences.ropSearch (run outside the app by the CT-307
//     reference runner) asserted through the kept panel's pixel readout;
//   - the winner is NOT simply the first draw: the pinned `rop` candidate for
//     the same seed is a different band, asserted to differ;
//   - History names the search, its size, the objective, and the best score
//     (builtinScriptReferences.ropSearchScore);
//   - a running search shows a DETERMINATE progress bar driven by the script's
//     own per-candidate reports, and Stop ends it with nothing delivered;
//   - CT-317: the winner arrives FROZEN. A press first opens the candidate
//     panel; the search then REPLACES that panel (the count stays 2) with a
//     one-band stack whose readout is the pinned winner, and a following press
//     opens a THIRD panel rather than replacing the winner.

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const FURTHER_CANDIDATE_PANEL = 3;
const LARGEST_GRID_LAYOUT = "2x3";
const LARGEST_GRID_PANEL_COUNT = 6;
const IMAGE = { width: multiBandTiff.width, height: multiBandTiff.height };
const FORCED_SEED = builtinScriptReferences.ropSeed;
const SEARCH_REFERENCE = builtinScriptReferences.ropSearch;
const OBJECTIVE_SCRIPT_FILE_NAME = String(SEARCH_REFERENCE.objectiveScript);
const SEARCHED_PROJECTION_COUNT = Number(SEARCH_REFERENCE.params.count);
const EXPECTED_SCORE_TEXT = builtinScriptReferences.ropSearchScore.value.toPrecision(4);
const FIRST_DRAW_VALUES = builtinScriptReferences.rop.values;
const RELATIVE_TOLERANCE = 1e-4;
const SEARCH_TIMEOUT_MS = 120_000;
// Long enough that the search is still looping when the test presses Stop, and
// long enough for the determinate bar to tick more than once.
const STOPPABLE_PROJECTION_COUNT = 200_000;

// The readout formats floats to four significant figures, so a parity assertion
// through the status bar allows the tolerance plus half the display quantum.
function readoutToleranceFor(referenceValue: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(referenceValue)));
  return Math.abs(referenceValue) * RELATIVE_TOLERANCE + 10 ** (magnitude - 3) / 2;
}

function referenceValueAtPixel(x: number, y: number): number {
  const value = SEARCH_REFERENCE.values[y * IMAGE.width + x];
  if (value === undefined) throw new Error(`rop_search reference is missing (${x}, ${y})`);
  return value;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp({
    extraEnvironment: { MSI_E2E_ROP_FORCED_SEED: String(FORCED_SEED) },
  });
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
  await importTheParchmentMask(launched.window);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("searches 50 projections and delivers the best-scoring one as a frozen stack", async () => {
  const page = launched.window;

  await openOperation(page, ROP_PANEL_LABEL);
  await expectSearchLockedUntilAnObjectiveIsChosen(page);

  await chooseRopObjective(page, "Custom script");
  await enqueueOpenDialogPaths(page, [fixturePath(OBJECTIVE_SCRIPT_FILE_NAME)]);
  await importRopObjectiveScript(page, OBJECTIVE_SCRIPT_FILE_NAME);

  await pressNewProjectionUntilProjectionReady(page, FORCED_SEED);
  await setRopProjectionCount(page, SEARCHED_PROJECTION_COUNT);
  await startRopProjectionSearch(page);
  await expectTheWinnerToHaveTakenOverTheCandidatePanel(page);

  await expectResultPanelMatchesThePinnedWinner(page);
  await expectResultPanelIsNotTheFirstDraw(page);
  await expectAFurtherPressToLeaveTheWinnerAlone(page);

  await closeRopOptions(page);
  await expectResultPanelIsAOneBandStackWhoseHistoryNamesTheSearch(page);
});

test("stops a running search, delivering nothing", async () => {
  const page = launched.window;

  await openOperation(page, ROP_PANEL_LABEL);
  await chooseRopObjective(page, "CNR");
  await setRopProjectionCount(page, STOPPABLE_PROJECTION_COUNT);
  await startRopProjectionSearch(page);

  await expectDeterminateProgressWhileSearching(page);
  await stopTheRunningSearch(page);

  await expect(page.getByText("Operation stopped")).toBeVisible();
  expect(await countPanels(page)).toBe(1);
  await expect(ropSearchButton(page)).toBeEnabled({ timeout: SEARCH_TIMEOUT_MS });
});

// CT-330: a search whose winner could not land anywhere must refuse BEFORE the
// (potentially long) run, not after. With every panel already in use and no
// candidate panel ever pressed, the pre-check has nothing to replace and
// nowhere fresh to open.
test("refuses a search before running when every panel is in use", async () => {
  const page = launched.window;

  await fillTheLargestGridWithDuplicates(page);
  await selectPanel(page, SOURCE_PANEL);
  await openOperation(page, ROP_PANEL_LABEL);
  await chooseRopObjective(page, "CNR");

  await expectSearchRefusedWithoutRunning(page);
});

async function fillTheLargestGridWithDuplicates(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Fill the largest grid layout with duplicates", async () => {
    await selectGridLayout(page, LARGEST_GRID_LAYOUT);
    for (let panel = 2; panel <= LARGEST_GRID_PANEL_COUNT; panel += 1) {
      await duplicatePanelViaContextMenu(page, SOURCE_PANEL);
      await expect(panelCanvas(page, panel)).toBeVisible();
      await expect(duplicateMenuItem(page)).toHaveCount(0);
    }
    await expect(panelGrid(page).getByRole("gridcell")).toHaveCount(LARGEST_GRID_PANEL_COUNT);
  });
}

function sourcePanelBusyOverlay(page: Page): Locator {
  return panelCell(page, SOURCE_PANEL)
    .locator('[role="status"]')
    .filter({ has: page.locator("svg.animate-spin") });
}

async function expectSearchRefusedWithoutRunning(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Search is marked disabled with an explaining tooltip", async () => {
    await expect(ropSearchButton(page)).toHaveAttribute("aria-disabled", "true");
  });
  await runAsStoryboardStep(page, "The search is refused before any run", async () => {
    await expect(sourcePanelBusyOverlay(page)).toHaveCount(0);
    await ropSearchButton(page).click({ force: true });
    await expect(page.getByText(ROP_PRESS_REFUSED_TEXT)).toBeVisible();
    await expect(ropSeedReadout(page)).toHaveText(ROP_NO_CANDIDATE_TEXT);
    await expect(sourcePanelBusyOverlay(page)).toHaveCount(0);
    expect(await countPanels(page)).toBe(LARGEST_GRID_PANEL_COUNT);
  });
}

async function importTheParchmentMask(page: Page): Promise<void> {
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await closeMasksOptions(page);
}

async function closeRopOptions(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Close the ROP options aside", async () => {
    await ropOptionsPanel(page).getByRole("button", { name: "Close ROP options" }).click();
    await expect(ropOptionsPanel(page)).toBeHidden();
  });
}

async function expectSearchLockedUntilAnObjectiveIsChosen(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The search needs an objective first", async () => {
    await expect(ropProjectionCountField(page)).toBeDisabled();
    await expect(ropProjectionCountField(page)).toHaveValue("10000");
    await expect(ropSearchButton(page)).toBeDisabled();
    await expect(ropOptionsPanel(page)).toContainText(
      "Choose an objective to search for the best projection.",
    );
  });
}

// CT-317: the winner is delivered FROZEN into the live candidate panel, so no
// third panel opens and the aside stops treating panel 2 as replaceable.
async function expectTheWinnerToHaveTakenOverTheCandidatePanel(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The best projection replaces the candidate panel", async () => {
    await expect(page.getByText("Projection kept")).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
    await expect(panelCanvas(page, RESULT_PANEL)).toBeVisible();
    expect(await countPanels(page)).toBe(RESULT_PANEL);
  });
}

// The winner arrived frozen, so the next press cannot reuse its panel.
async function expectAFurtherPressToLeaveTheWinnerAlone(page: Page): Promise<void> {
  await pressNewProjectionUntilProjectionReady(page, FORCED_SEED);
  await runAsStoryboardStep(page, "The next press opened a further panel", async () => {
    await expect(panelCanvas(page, FURTHER_CANDIDATE_PANEL)).toBeVisible();
    expect(await countPanels(page)).toBe(FURTHER_CANDIDATE_PANEL);
  });
  await expectResultPanelMatchesThePinnedWinner(page);
}

async function expectResultPanelMatchesThePinnedWinner(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The delivered stack is the pinned winner", async () => {
    for (const pixel of [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 3 },
      { x: 3, y: 3 },
    ]) {
      const expected = referenceValueAtPixel(pixel.x, pixel.y);
      await expectPixelReadoutToEqual(page, {
        panel: RESULT_PANEL,
        imageX: pixel.x,
        imageY: pixel.y,
        dimensions: IMAGE,
        expected,
        tolerance: readoutToleranceFor(expected),
      });
    }
  });
}

// The seeded sequence's FIRST candidate is pinned as builtinScriptReferences.rop,
// so a "search" that returned it would have ignored its objective.
async function expectResultPanelIsNotTheFirstDraw(page: Page): Promise<void> {
  const firstDrawOrigin = FIRST_DRAW_VALUES[0];
  const winnerOrigin = referenceValueAtPixel(0, 0);
  expect(firstDrawOrigin).toBeDefined();
  expect(Math.abs(winnerOrigin - Number(firstDrawOrigin))).toBeGreaterThan(1);
  await expect(panelCanvas(page, RESULT_PANEL)).toBeVisible();
}

async function expectResultPanelIsAOneBandStackWhoseHistoryNamesTheSearch(page: Page): Promise<void> {
  await selectPanel(page, RESULT_PANEL);
  await runAsStoryboardStep(page, "The winner is a one-band stack", async () => {
    expect((await readMetadata(page)).bandCount).toBe("1");
  });
  await expectHistoryToRecordOperation(page, {
    actionLabel: ROP_PANEL_LABEL,
    detailSubstrings: [
      `ROP search (${SEARCHED_PROJECTION_COUNT} projections, ${OBJECTIVE_SCRIPT_FILE_NAME}: ${EXPECTED_SCORE_TEXT})`,
    ],
  });
}

function searchBusyCard(page: Page) {
  return page.getByRole("status", { name: "Running analysis..." });
}

// The bar must ADVANCE, not merely appear: the cube upload also drives it for
// an instant, but only the script's per-candidate reports keep raising it while
// the worker runs.
async function expectDeterminateProgressWhileSearching(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The search reports determinate progress", async () => {
    const progressBar = searchBusyCard(page).getByRole("progressbar");
    await expect(progressBar).toBeVisible({ timeout: SEARCH_TIMEOUT_MS });
    const first = await readReportedProgress(progressBar);
    expect(first).toBeLessThan(1);
    await expect
      .poll(() => readReportedProgress(progressBar), { timeout: SEARCH_TIMEOUT_MS })
      .toBeGreaterThan(first);
  });
}

async function readReportedProgress(progressBar: Locator): Promise<number> {
  return Number(await progressBar.getAttribute("aria-valuenow"));
}

async function stopTheRunningSearch(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Stop the search", async () => {
    await searchBusyCard(page).getByRole("button", { name: "Stop" }).click();
  });
}
