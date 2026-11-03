import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { runAsStoryboardStep } from "./storyboard-step";

// CT-308: "NPC" is a menu-only Multi-band command that opens
// <aside aria-label="Potential Contrast options">. The panel computes scores and shows them to
// four significant figures; it never places a raster, so it has a Compute
// button instead of Apply and no result-destination control.
//
// CT-319: the result is one score PER BAND, presented as a line plot plus a
// "Top bands" list. There is no scalar readout to read any more: the oracle is
// the list of rows, each <output aria-label="Potential Contrast top band N">.

export const NPC_PANEL_LABEL = "Potential Contrast";
export const NPC_NOT_COMPUTED_TEXT = "Not computed yet";

export function npcOptionsPanel(page: Page): Locator {
  return page.locator('aside[aria-label="Potential Contrast options"]');
}

export function npcMaskLayerPicker(page: Page): Locator {
  return npcOptionsPanel(page).getByRole("combobox", { name: "Mask layer" });
}

export function npcBinsField(page: Page): Locator {
  return npcOptionsPanel(page).getByRole("spinbutton", { name: "Bins" });
}

export function npcComputeButton(page: Page): Locator {
  return npcOptionsPanel(page).getByRole("button", { name: /^Compute/ });
}

export function npcScoresSection(page: Page): Locator {
  return npcOptionsPanel(page).locator('section[aria-label="Potential Contrast scores"]');
}

export function npcScorePlot(page: Page): Locator {
  return npcScoresSection(page).locator("figure");
}

export function npcTopBandRows(page: Page): Locator {
  return npcScoresSection(page).locator('output[aria-label^="Potential Contrast top band "]');
}

export async function setNpcBinCount(page: Page, bins: number): Promise<void> {
  await runAsStoryboardStep(page, `Set the NPC bin count to ${bins}`, async () => {
    await npcBinsField(page).fill(String(bins));
    await expect(npcBinsField(page)).toHaveValue(String(bins));
  });
}

export interface NpcTopBandRowReadout {
  readonly bandIdentityText: string;
  readonly scoreText: string;
}

// Compute runs the packaged Python analysis out of process, so the list only
// settles once the worker returns. Two runs of the same stack can legitimately
// produce the SAME numbers, so "the text changed" is no completion signal:
// changing the bins first clears the section back to "Not computed yet", and
// the rows arriving there are what we wait on.
export async function computeNpcScores(page: Page): Promise<NpcTopBandRowReadout[]> {
  return runAsStoryboardStep(page, "Compute the NPC scores and read the top bands", async () => {
    await npcComputeButton(page).click();
    await expect(npcScoresSection(page)).toHaveText(NPC_NOT_COMPUTED_TEXT);
    await expect(npcTopBandRows(page).first()).toBeVisible({ timeout: NPC_RUN_TIMEOUT_MS });
    return readNpcTopBandRows(page);
  });
}

export async function readNpcTopBandRows(page: Page): Promise<NpcTopBandRowReadout[]> {
  const rowTexts = await npcTopBandRows(page).allInnerTexts();
  return rowTexts.map(splitTopBandRowText);
}

function splitTopBandRowText(rowText: string): NpcTopBandRowReadout {
  const parts = rowText.split(/\s+/).filter((part) => part.length > 0);
  const scoreText = parts[parts.length - 1] ?? "";
  return { bandIdentityText: parts.slice(0, -1).join(" "), scoreText };
}

const NPC_RUN_TIMEOUT_MS = 60_000;

export function expectScoreWithinRelativeTolerance(
  actual: number,
  expected: number,
  tolerance = 1e-4,
): void {
  const allowed = Math.max(Math.abs(expected), 1) * tolerance;
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(allowed);
}
