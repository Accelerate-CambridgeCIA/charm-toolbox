import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { runAsStoryboardStep } from "./storyboard-step";

// CT-309: "ROP" is a menu-only Multi-band command that opens
// <aside aria-label="ROP options">. CT-316: New projection delivers a fresh
// random candidate as a one-band stack in a candidate panel next to the source
// (the next press replaces it); Keep / Keep best commit a candidate as a new
// stack. Launch the app with MSI_E2E_ROP_FORCED_SEED to make every press
// reproduce the reference candidate pinned in manifest.json, and change the
// seed between presses with setForcedRopSeed.

export const ROP_PANEL_LABEL = "ROP";
export const ROP_NO_CANDIDATE_TEXT = "No projection yet";
export const ROP_PROJECTION_READY_TEXT = "Projection ready";
export const ROP_PRESS_REFUSED_TEXT = "Every panel is in use. Close a panel before projecting.";

export async function setForcedRopSeed(page: Page, seed: number): Promise<void> {
  await runAsStoryboardStep(page, `Force the next ROP seed to ${seed}`, async () => {
    await page.evaluate((forced) => window.toolboxE2E.setRopForcedSeedOverride(forced), seed);
  });
}

export function ropOptionsPanel(page: Page): Locator {
  return page.locator('aside[aria-label="ROP options"]');
}

// CT-315: the aside pins to the panel it was opened on, and its header names
// that panel for as long as the pin holds.
export function ropPinnedPanelReadout(page: Page): Locator {
  return ropOptionsPanel(page).getByText(/^Panel \d+$/);
}

// CT-333: the aside names the panel it projects from, and moves to the
// selected panel only through its own button.
export function ropSourcePanelReadout(page: Page): Locator {
  return ropOptionsPanel(page).locator('output[aria-label="ROP source panel"]');
}

export function ropUseSelectedPanelButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: "Use selected panel" });
}

export async function useTheSelectedPanelAsRopSource(page: Page, panelNumber: number): Promise<void> {
  await runAsStoryboardStep(page, `Project from the selected panel ${panelNumber}`, async () => {
    await ropUseSelectedPanelButton(page).click();
    await expect(ropSourcePanelReadout(page)).toHaveText(`Projecting from Panel ${panelNumber}`);
  });
}

export function ropObjectivePicker(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("combobox", { name: "Objective" });
}

export function ropCnrTextCategoryPicker(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("combobox", { name: "Text category" });
}

export function ropCnrBackgroundCategoryPicker(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("combobox", { name: "Background category" });
}

export function ropNewProjectionButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: /^(New projection|Projecting)/ });
}

export function ropSeedReadout(page: Page): Locator {
  return ropOptionsPanel(page).locator('output[aria-label="ROP seed"]');
}

export function ropScoreReadout(page: Page): Locator {
  return ropOptionsPanel(page).locator('output[aria-label="ROP score"]');
}

export function ropBestScoreReadout(page: Page): Locator {
  return ropOptionsPanel(page).locator('output[aria-label="Best ROP score"]');
}

export function ropKeepButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: "Keep", exact: true });
}

export function ropKeepBestButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: "Keep best" });
}

export async function chooseRopObjective(page: Page, optionLabel: string): Promise<void> {
  await runAsStoryboardStep(page, `Choose the ${optionLabel} objective`, async () => {
    await ropObjectivePicker(page).selectOption({ label: optionLabel });
  });
}

// The first press spawns the Python worker and uploads the cube, so the
// completion signal (the seed readout showing the pressed seed, then the
// button re-enabling once the candidate stack has been placed) can take a
// while; later presses reuse the retained session and settle fast.
export async function pressNewProjectionUntilSeedShows(
  page: Page,
  expectedSeed: number,
): Promise<void> {
  await runAsStoryboardStep(page, `Press New projection (seed ${expectedSeed})`, async () => {
    await ropNewProjectionButton(page).click();
    await expect(ropSeedReadout(page)).toHaveText(`Seed ${expectedSeed}`, {
      timeout: ROP_RUN_TIMEOUT_MS,
    });
    await expect(ropNewProjectionButton(page)).toBeEnabled({ timeout: ROP_RUN_TIMEOUT_MS });
  });
}

export async function pressNewProjectionUntilScoreShows(
  page: Page,
  expectedScoreText: string,
): Promise<void> {
  await runAsStoryboardStep(page, "Press New projection and wait for its score", async () => {
    await ropNewProjectionButton(page).click();
    await expect(ropScoreReadout(page)).toHaveText(expectedScoreText, {
      timeout: ROP_RUN_TIMEOUT_MS,
    });
    await expect(ropNewProjectionButton(page)).toBeEnabled({ timeout: ROP_RUN_TIMEOUT_MS });
  });
}

// CT-316: a press ends with the "Projection ready" toast once its candidate
// stack has landed in the candidate panel.
export async function pressNewProjectionUntilProjectionReady(
  page: Page,
  expectedSeed: number,
): Promise<void> {
  await runAsStoryboardStep(page, `Press New projection (seed ${expectedSeed}) and wait for the stack`, async () => {
    await ropNewProjectionButton(page).click();
    await expect(page.getByText(ROP_PROJECTION_READY_TEXT).last()).toBeVisible({
      timeout: ROP_RUN_TIMEOUT_MS,
    });
    await expect(ropSeedReadout(page)).toHaveText(`Seed ${expectedSeed}`);
    await expect(ropNewProjectionButton(page)).toBeEnabled({ timeout: ROP_RUN_TIMEOUT_MS });
  });
}

const ROP_RUN_TIMEOUT_MS = 60_000;

// CT-310: the search section. "Search" runs every candidate inside ONE Python
// run and delivers the best one as a new stack, so the completion signal is the
// kept-projection toast, not a readout.

export function ropProjectionCountField(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("spinbutton", { name: "Projections" });
}

export function ropSearchButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: /^(Search|Searching)/ });
}

export function ropImportObjectiveScriptButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: "Import script..." });
}

export async function setRopProjectionCount(page: Page, projectionCount: number): Promise<void> {
  await runAsStoryboardStep(page, `Search ${projectionCount} projections`, async () => {
    await ropProjectionCountField(page).fill(String(projectionCount));
  });
}

export async function importRopObjectiveScript(page: Page, fileName: string): Promise<void> {
  await runAsStoryboardStep(page, `Import the ${fileName} objective`, async () => {
    await ropImportObjectiveScriptButton(page).click();
    await expect(ropOptionsPanel(page)).toContainText(`Objective loaded: ${fileName}.`);
  });
}

export async function startRopProjectionSearch(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Start the projection search", async () => {
    await ropSearchButton(page).click();
  });
}
