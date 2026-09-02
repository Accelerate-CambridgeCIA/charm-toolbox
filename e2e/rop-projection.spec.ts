import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  builtinScriptReferences,
  fixturePath,
  maskMultibandPng,
  multiBandTiff,
} from "./fixtures/fixture-manifest";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { readPythonWorkerSpawnCount } from "./support/dialog-stub-controls";
import { selectGridLayout } from "./support/grid-layout-controls";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  chooseRopObjective,
  closeMasksOptions,
  countPanels,
  duplicateMenuItem,
  duplicatePanelViaContextMenu,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  importMaskFromPath,
  loadFixtureAsStack,
  openMasksOptions,
  openOperation,
  panelCanvas,
  panelCell,
  panelGrid,
  pressNewProjectionUntilProjectionReady,
  pressNewProjectionUntilScoreShows,
  readHistoryEntries,
  readMetadata,
  readPixelValueAt,
  ropCnrBackgroundCategoryPicker,
  ropCnrTextCategoryPicker,
  ropKeepButton,
  ropNewProjectionButton,
  ropObjectivePicker,
  ropOptionsPanel,
  ropPinnedPanelReadout,
  ropScoreReadout,
  ropSeedReadout,
  ropSourcePanelReadout,
  ropUseSelectedPanelButton,
  ROP_NO_CANDIDATE_TEXT,
  ROP_PANEL_LABEL,
  ROP_PRESS_REFUSED_TEXT,
  selectPanel,
  setForcedRopSeed,
  useTheSelectedPanelAsRopSource,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-309 / CT-316: press-to-reroll random orthogonal projections, each press
// delivered as a REAL one-band stack in a candidate panel next to the source.
// The stack is multiband-12bit.tif (4x4x3 uint16, renders near-black by
// default) and the labels come from importing mask-multiband.png (top row
// Parchment, bottom row Substrate). The app is launched with
// MSI_E2E_ROP_FORCED_SEED so the first press draws the reference seed; later
// presses change the seed through the bridge.
//
// ORACLES, one per claim the story makes:
//   - a press delivers the REFERENCE projection into the candidate panel:
//     manifest.json's builtinScriptReferences.rop, pinned by the CT-307
//     reference runner executing the SAME packaged rop.py outside the app,
//     asserted through the candidate panel's pixel readout within 1e-4
//     relative tolerance (plus the readout's four-significant-figure quantum),
//     and its Metadata reports one band;
//   - the SOURCE panel is untouched: its readout at (0,0) still reports the
//     stack's true value and its canvas still renders near-black
//     (nonClearPixelFraction, the normalized-viewing.spec.ts pattern);
//   - the next press REPLACES the candidate panel: the panel count is
//     unchanged and the readout differs from the first candidate;
//   - a full grid at its largest layout REFUSES the press before any run;
//   - the CNR score matches builtinScriptReferences.ropCnr, computed by the
//     generator with the exact locked formula over the reference candidate,
//     and History on the candidate panel ends with exactly one ROP entry;
//   - CT-317: Keep FREEZES the candidate panel - after it, Keep is disabled,
//     the next press opens a THIRD panel instead of replacing panel 2, panel 2
//     still reads the first seed's reference projection, panel 3 reads
//     something else, and panel 2's History still ends with that seed's ROP
//     entry. (Only the first seed has a pinned reference, so the second press
//     is asserted to DIFFER from it rather than against a reference of its own.)

const SOURCE_PANEL = 1;
const CANDIDATE_PANEL = 2;
const SECOND_CANDIDATE_PANEL = 3;
const IMAGE = { width: multiBandTiff.width, height: multiBandTiff.height };
const FORCED_SEED = Number(builtinScriptReferences.rop.params.seed);
const OTHER_SEED = FORCED_SEED + 1;
const REFERENCE_VALUES = builtinScriptReferences.rop.values;
const REFERENCE_CNR_SCORE = builtinScriptReferences.ropCnr.value;
const EXPECTED_SCORE_TEXT = REFERENCE_CNR_SCORE.toPrecision(4);
const SOURCE_ORIGIN_VALUE = String(multiBandTiff.samplePixels[0]?.valuesPerBand[0]);
const NEAR_BLACK_FRACTION_CEILING = 0.02;
const RELATIVE_TOLERANCE = 1e-4;
const LARGEST_GRID_LAYOUT = "2x3";
const LARGEST_GRID_PANEL_COUNT = 6;
const CORNER_PIXELS = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 0, y: 3 },
  { x: 3, y: 3 },
];

// The readout formats float values to four significant figures, so the parity
// assertion allows the reference tolerance plus half the display quantum.
function readoutToleranceFor(referenceValue: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(referenceValue)));
  const displayQuantum = 10 ** (magnitude - 3);
  return Math.abs(referenceValue) * RELATIVE_TOLERANCE + displayQuantum / 2;
}

function referenceValueAtPixel(x: number, y: number): number {
  const value = REFERENCE_VALUES[y * IMAGE.width + x];
  if (value === undefined) throw new Error(`rop reference is missing pixel (${x}, ${y})`);
  return value;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp({
    extraEnvironment: { MSI_E2E_ROP_FORCED_SEED: String(FORCED_SEED) },
  });
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("delivers each press as a one-band stack next to the source and replaces it on the next press", async () => {
  const page = launched.window;

  await importTheParchmentMask(page);
  await expectSourcePanelRendersNearBlack(page);
  await assertSourceOriginStillReadsItsTrueValue(page);

  await openOperation(page, ROP_PANEL_LABEL);
  await expect(ropSeedReadout(page)).toHaveText(ROP_NO_CANDIDATE_TEXT);
  await pressNewProjectionUntilProjectionReady(page, FORCED_SEED);

  await expectCandidatePanelOpenedNextToTheSource(page);
  await expectPanelMatchesTheReferenceProjection(page, CANDIDATE_PANEL);
  await expectSourcePanelUntouchedByThePress(page);

  await setForcedRopSeed(page, OTHER_SEED);
  await pressNewProjectionUntilProjectionReady(page, OTHER_SEED);
  await expectSecondPressReplacedTheCandidatePanel(page);

  await setForcedRopSeed(page, FORCED_SEED);
  await chooseRopObjective(page, "CNR");
  await expectCnrCategoriesDefaultToParchmentOverSubstrate(page);
  await pressNewProjectionUntilScoreShows(page, EXPECTED_SCORE_TEXT);
  await expectPanelMatchesTheReferenceProjection(page, CANDIDATE_PANEL);

  await closeRopOptions(page);
  await expectCandidatePanelIsAOneBandStackWithOneRopHistoryEntry(page);
});

test("freezes the candidate panel on Keep so the next press opens a new panel", async () => {
  const page = launched.window;

  await openOperation(page, ROP_PANEL_LABEL);
  await pressNewProjectionUntilProjectionReady(page, FORCED_SEED);
  await keepTheCandidateOnScreen(page);
  await expectKeepToBeUnavailableWithNothingLeftToFreeze(page);

  await setForcedRopSeed(page, OTHER_SEED);
  await pressNewProjectionUntilProjectionReady(page, OTHER_SEED);
  await expectTheSecondPressToHaveOpenedAFurtherPanel(page);

  await expectPanelMatchesTheReferenceProjection(page, CANDIDATE_PANEL);
  await expectPanelToDifferFromTheReferenceProjection(page, SECOND_CANDIDATE_PANEL);

  await closeRopOptions(page);
  await expectFrozenPanelHistoryToEndWithTheFirstSeedsRopEntry(page);
});

test("refuses a press when every panel is in use and the grid cannot grow", async () => {
  const page = launched.window;

  await fillTheLargestGridWithDuplicates(page);
  await selectPanel(page, SOURCE_PANEL);
  await openOperation(page, ROP_PANEL_LABEL);
  await expectPressRefusedWithoutRunning(page);
});

// CT-315: the aside pins to the panel it was opened on. A duplicate arriving
// in panel 3 and taking the selection must not retarget it, so the ORACLES are
// the header still naming panel 1, the candidate surviving (a retarget resets
// the panel state to "No projection yet"), and the next press still replacing
// the candidate panel with the reference projection of panel 1's cube.
test("stays pinned to its source panel when a duplicate takes the selection", async () => {
  const page = launched.window;
  const DUPLICATE_PANEL = 3;

  await openOperation(page, ROP_PANEL_LABEL);
  await expectRopAsideToNamePanel(page, SOURCE_PANEL);
  await pressNewProjectionUntilProjectionReady(page, FORCED_SEED);

  await duplicateSourcePanelAndSelectTheCopy(page, DUPLICATE_PANEL);
  await expectRopAsideToNamePanel(page, SOURCE_PANEL);
  await expectRopCandidateToHaveSurvivedTheSelectionChange(page);

  await pressNewProjectionUntilProjectionReady(page, FORCED_SEED);
  expect(await countPanels(page)).toBe(3);
  await expectPanelMatchesTheReferenceProjection(page, CANDIDATE_PANEL);
});

// CT-333: the pin moves on ONE deliberate act. The aside names its source
// panel, offers the selected panel by number, and re-pinning starts the
// session over on the new stack: no candidate, nothing to keep, and the
// candidate panel from the old source left behind as an ordinary stack.
test("moves its source to the selected panel on request and starts over there", async () => {
  const page = launched.window;
  const DUPLICATE_PANEL = 3;
  const PANEL_COUNT_BEFORE_THE_NEXT_PRESS = 3;
  const REPINNED_CANDIDATE_PANEL = 4;

  await openOperation(page, ROP_PANEL_LABEL);
  await expectRopAsideToProjectFromPanel(page, SOURCE_PANEL);
  await pressNewProjectionUntilProjectionReady(page, FORCED_SEED);

  await duplicateSourcePanelAndSelectTheCopy(page, DUPLICATE_PANEL);
  await expectRopAsideToProjectFromPanel(page, SOURCE_PANEL);
  await expectUseSelectedPanelToOfferPanel(page, DUPLICATE_PANEL);

  await useTheSelectedPanelAsRopSource(page, DUPLICATE_PANEL);
  await expectRopAsideToHaveStartedOverOnPanel(page, DUPLICATE_PANEL, PANEL_COUNT_BEFORE_THE_NEXT_PRESS);

  await setForcedRopSeed(page, OTHER_SEED);
  await pressNewProjectionUntilProjectionReady(page, OTHER_SEED);
  await expectTheNewSourcesPressToOpenAFurtherPanel(page, REPINNED_CANDIDATE_PANEL);
  await expectPanelMatchesTheReferenceProjection(page, CANDIDATE_PANEL);
});

// CT-335: the retained ROP session runs on ONE resident interpreter that
// loaded the cube once, so three presses cost exactly one spawn. The oracle is
// main's own spawn counter (toolboxE2E.readPythonWorkerSpawnCount, counting
// one-shot and resident spawns alike), plus the pinned reference for the first
// press (the resident path must not change what a press computes) and a third
// press that really is a different projection.
test("keeps one resident Python worker across three presses", async () => {
  const page = launched.window;
  const THIRD_SEED = FORCED_SEED + 2;

  await openOperation(page, ROP_PANEL_LABEL);
  const spawnsBeforeAnyPress = await readSpawnCountBeforeAnyPress(page);

  await pressNewProjectionUntilProjectionReady(page, FORCED_SEED);
  await expectPanelMatchesTheReferenceProjection(page, CANDIDATE_PANEL);

  await setForcedRopSeed(page, OTHER_SEED);
  await pressNewProjectionUntilProjectionReady(page, OTHER_SEED);
  await setForcedRopSeed(page, THIRD_SEED);
  await pressNewProjectionUntilProjectionReady(page, THIRD_SEED);
  await expectPanelToDifferFromTheReferenceProjection(page, CANDIDATE_PANEL);

  await expectSpawnCountRoseByExactlyOne(page, spawnsBeforeAnyPress);
});

test("locks the mask objectives until a layer with two painted categories exists", async () => {
  const page = launched.window;

  await openOperation(page, ROP_PANEL_LABEL);
  await expectMaskObjectivesLockedWithAnExplanation(page);

  await closeRopOptions(page);
  await importTheParchmentMask(page);
  await openOperation(page, ROP_PANEL_LABEL);

  await expect(ropObjectivePicker(page).locator('option[value="npc"]')).toHaveJSProperty(
    "disabled",
    false,
  );
  await expect(ropObjectivePicker(page).locator('option[value="cnr"]')).toHaveJSProperty(
    "disabled",
    false,
  );
  await expect(ropOptionsPanel(page)).not.toContainText("painted pixels");
});

async function expectRopAsideToProjectFromPanel(page: Page, panelNumber: number): Promise<void> {
  await runAsStoryboardStep(page, `The ROP aside projects from panel ${panelNumber}`, async () => {
    await expect(ropSourcePanelReadout(page)).toHaveText(`Projecting from Panel ${panelNumber}`);
    await expect(ropPinnedPanelReadout(page)).toHaveText(`Panel ${panelNumber}`);
  });
}

async function expectUseSelectedPanelToOfferPanel(page: Page, panelNumber: number): Promise<void> {
  await runAsStoryboardStep(page, `Use selected panel offers panel ${panelNumber}`, async () => {
    await expect(ropUseSelectedPanelButton(page)).toBeEnabled();
    await expect(ropUseSelectedPanelButton(page)).toHaveText(
      `Use selected panel (Panel ${panelNumber})`,
    );
  });
}

// Re-pinning releases the retained session, so the aside holds no candidate and
// no pointer to freeze; the old source's candidate panel simply stays on screen.
async function expectRopAsideToHaveStartedOverOnPanel(
  page: Page,
  panelNumber: number,
  expectedPanelCount: number,
): Promise<void> {
  await runAsStoryboardStep(page, `The aside starts over on panel ${panelNumber}`, async () => {
    await expect(ropPinnedPanelReadout(page)).toHaveText(`Panel ${panelNumber}`);
    await expect(ropSeedReadout(page)).toHaveText(ROP_NO_CANDIDATE_TEXT);
    await expect(ropKeepButton(page)).toBeDisabled();
    await expect(ropUseSelectedPanelButton(page)).toBeDisabled();
    expect(await countPanels(page)).toBe(expectedPanelCount);
  });
}

async function expectTheNewSourcesPressToOpenAFurtherPanel(
  page: Page,
  panelNumber: number,
): Promise<void> {
  await runAsStoryboardStep(page, `The press from the new source opened panel ${panelNumber}`, async () => {
    await expect(panelCanvas(page, panelNumber)).toBeVisible();
    expect(await countPanels(page)).toBe(panelNumber);
  });
}

async function readSpawnCountBeforeAnyPress(page: Page): Promise<number> {
  let count = 0;
  await runAsStoryboardStep(page, "Read the interpreter spawn count before any press", async () => {
    count = await readPythonWorkerSpawnCount(page);
  });
  return count;
}

async function expectSpawnCountRoseByExactlyOne(page: Page, countBefore: number): Promise<void> {
  await runAsStoryboardStep(page, "Three presses cost exactly one interpreter spawn", async () => {
    expect(await readPythonWorkerSpawnCount(page)).toBe(countBefore + 1);
  });
}

async function importTheParchmentMask(page: Page): Promise<void> {
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await closeMasksOptions(page);
}

async function expectRopAsideToNamePanel(page: Page, panelNumber: number): Promise<void> {
  await runAsStoryboardStep(page, `The ROP aside targets panel ${panelNumber}`, async () => {
    await expect(ropPinnedPanelReadout(page)).toHaveText(`Panel ${panelNumber}`);
  });
}

async function duplicateSourcePanelAndSelectTheCopy(page: Page, duplicatePanel: number): Promise<void> {
  await runAsStoryboardStep(page, "Duplicate the source panel and select the copy", async () => {
    await duplicatePanelViaContextMenu(page, SOURCE_PANEL);
    await expect(panelCanvas(page, duplicatePanel)).toBeVisible();
    await selectPanel(page, duplicatePanel);
  });
}

async function expectRopCandidateToHaveSurvivedTheSelectionChange(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The candidate survived the selection change", async () => {
    await expect(ropSeedReadout(page)).toHaveText(`Seed ${FORCED_SEED}`);
  });
}

async function closeRopOptions(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Close the ROP options aside", async () => {
    await ropOptionsPanel(page).getByRole("button", { name: "Close ROP options" }).click();
    await expect(ropOptionsPanel(page)).toBeHidden();
  });
}

async function expectSourcePanelRendersNearBlack(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The source panel renders near-black", async () => {
    const canvas = panelCanvas(page, SOURCE_PANEL);
    await expect
      .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
      .toBeLessThan(NEAR_BLACK_FRACTION_CEILING);
  });
}

async function assertSourceOriginStillReadsItsTrueValue(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The source readout still reports the true value", async () => {
    const readout = await readPixelValueAt(page, SOURCE_PANEL, 0, 0, IMAGE);
    expect(readout.value).toBe(SOURCE_ORIGIN_VALUE);
  });
}

// The source panel is never touched by a press: same data, same display, and
// it keeps the selection (the delivery passes selectResultPanel: false).
async function expectSourcePanelUntouchedByThePress(page: Page): Promise<void> {
  await assertSourceOriginStillReadsItsTrueValue(page);
  await expectSourcePanelRendersNearBlack(page);
  await runAsStoryboardStep(page, "The source panel stays selected", async () => {
    await expect(panelCell(page, SOURCE_PANEL)).toHaveAttribute("aria-selected", "true");
    await expect(panelCell(page, CANDIDATE_PANEL)).toHaveAttribute("aria-selected", "false");
  });
}

async function expectCandidatePanelOpenedNextToTheSource(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The candidate stack opened in panel 2", async () => {
    await expect(panelCanvas(page, CANDIDATE_PANEL)).toBeVisible();
    expect(await countPanels(page)).toBe(2);
  });
}

async function expectSecondPressReplacedTheCandidatePanel(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The second press replaced panel 2 in place", async () => {
    expect(await countPanels(page)).toBe(2);
    const reference = referenceValueAtPixel(0, 0);
    const readout = await readPixelValueAt(page, CANDIDATE_PANEL, 0, 0, IMAGE);
    expect(Math.abs(Number(readout.value) - reference)).toBeGreaterThan(readoutToleranceFor(reference));
  });
}

async function expectCnrCategoriesDefaultToParchmentOverSubstrate(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "CNR defaults to categories 1 and 2", async () => {
    await expect(ropCnrTextCategoryPicker(page)).toHaveValue("1");
    await expect(ropCnrBackgroundCategoryPicker(page)).toHaveValue("2");
  });
}

// CT-317: Keep copies nothing - it drops the aside's pointer to the candidate
// panel, so the panel count is unchanged and the stack simply stops being
// replaceable.
async function keepTheCandidateOnScreen(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Keep the candidate on screen", async () => {
    await ropKeepButton(page).click();
    await expect(page.getByText("Projection kept")).toBeVisible();
    expect(await countPanels(page)).toBe(2);
  });
}

async function expectKeepToBeUnavailableWithNothingLeftToFreeze(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Keep is disabled with no live candidate panel", async () => {
    await expect(ropKeepButton(page)).toBeDisabled();
    await expect(ropSeedReadout(page)).toHaveText(`Seed ${FORCED_SEED}`);
  });
}

async function expectTheSecondPressToHaveOpenedAFurtherPanel(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The next press opened panel 3 instead of replacing panel 2", async () => {
    await expect(panelCanvas(page, SECOND_CANDIDATE_PANEL)).toBeVisible();
    expect(await countPanels(page)).toBe(3);
  });
}

async function expectPanelToDifferFromTheReferenceProjection(
  page: Page,
  panel: number,
): Promise<void> {
  await runAsStoryboardStep(page, `Panel ${panel} is a different projection`, async () => {
    const reference = referenceValueAtPixel(0, 0);
    const readout = await readPixelValueAt(page, panel, 0, 0, IMAGE);
    expect(Math.abs(Number(readout.value) - reference)).toBeGreaterThan(readoutToleranceFor(reference));
  });
}

// The frozen panel keeps the History it was delivered with: Keep appends
// nothing, so the entry still names the seed of the press that made it.
async function expectFrozenPanelHistoryToEndWithTheFirstSeedsRopEntry(page: Page): Promise<void> {
  await selectPanel(page, CANDIDATE_PANEL);
  await expectHistoryToRecordOperation(page, {
    actionLabel: ROP_PANEL_LABEL,
    detailSubstrings: [`ROP (seed ${FORCED_SEED})`],
  });
  await runAsStoryboardStep(page, "Keep appended nothing to the frozen panel's History", async () => {
    const entries = await readHistoryEntries(page);
    expect(entries[entries.length - 1]?.actionLabel).toBe(ROP_PANEL_LABEL);
    expect(entries.filter((entry) => entry.actionLabel === ROP_PANEL_LABEL)).toHaveLength(1);
  });
}

async function expectPanelMatchesTheReferenceProjection(
  page: Page,
  panel: number,
): Promise<void> {
  await runAsStoryboardStep(page, `Panel ${panel} matches the pinned reference projection`, async () => {
    for (const pixel of CORNER_PIXELS) {
      const expected = referenceValueAtPixel(pixel.x, pixel.y);
      await expectPixelReadoutToEqual(page, {
        panel,
        imageX: pixel.x,
        imageY: pixel.y,
        dimensions: IMAGE,
        expected,
        tolerance: readoutToleranceFor(expected),
      });
    }
  });
}

// Metadata and History only render while no aside is open, and they describe
// the SELECTED panel. Replacing the candidate re-derives its state from the
// source, so History carries exactly one ROP entry: the candidate on screen.
async function expectCandidatePanelIsAOneBandStackWithOneRopHistoryEntry(page: Page): Promise<void> {
  await selectPanel(page, CANDIDATE_PANEL);
  await runAsStoryboardStep(page, "Panel 2 is a one-band stack", async () => {
    expect((await readMetadata(page)).bandCount).toBe("1");
  });
  await runAsStoryboardStep(page, "Panel 2's History ends with one ROP entry", async () => {
    await expectHistoryToRecordOperation(page, {
      actionLabel: ROP_PANEL_LABEL,
      detailSubstrings: [`ROP (seed ${FORCED_SEED}, CNR: ${EXPECTED_SCORE_TEXT})`],
    });
    const entries = await readHistoryEntries(page);
    const ropEntries = entries.filter((entry) => entry.actionLabel === ROP_PANEL_LABEL);
    expect(ropEntries).toHaveLength(1);
    expect(entries[entries.length - 1]?.actionLabel).toBe(ROP_PANEL_LABEL);
  });
}

// Duplicate lands in the lowest free panel, so five duplicates of the source
// fill the six-panel layout. The context menu hides the grid from the
// accessibility tree while it closes, so the cell count is polled, not read.
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

async function expectPressRefusedWithoutRunning(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The press is refused before any run", async () => {
    await ropNewProjectionButton(page).click();
    await expect(page.getByText(ROP_PRESS_REFUSED_TEXT)).toBeVisible();
    await expect(ropSeedReadout(page)).toHaveText(ROP_NO_CANDIDATE_TEXT);
    await expect(ropNewProjectionButton(page)).toBeEnabled();
    expect(await countPanels(page)).toBe(LARGEST_GRID_PANEL_COUNT);
  });
}

async function expectMaskObjectivesLockedWithAnExplanation(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Mask objectives are locked with no mask layers", async () => {
    await expect(ropObjectivePicker(page)).toHaveValue("none");
    await expect(ropObjectivePicker(page).locator('option[value="npc"]')).toHaveJSProperty(
      "disabled",
      true,
    );
    await expect(ropObjectivePicker(page).locator('option[value="cnr"]')).toHaveJSProperty(
      "disabled",
      true,
    );
    await expect(ropOptionsPanel(page)).toContainText(
      "NPC and CNR need a mask layer with at least two categories that have painted pixels.",
    );
    await expect(ropNewProjectionButton(page)).toBeEnabled();
    await expect(ropScoreReadout(page)).toHaveCount(0);
  });
}
