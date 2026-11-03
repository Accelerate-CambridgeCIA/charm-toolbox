// CT-219g scratch verification (NEVER COMMITTED, the ct219b-verify precedent):
// proves the chunked user-script run protocol at reference scale
// (8000x6000x16 uint16, ~3 GB as float32 script input) against the real app.
// Cases: a Band Weighting formula run (np.arange), a Band Selection formula
// run (cube.max(axis=0)), a Custom Transform formula run (cube * 2), each with
// oracle-correct Apply via the pixel readout, renderer interactivity during
// the cube handoff (rAF heartbeat, no >5 s gap), busy feedback while the run
// is in flight, and the 30 s wall clock demonstrably killing a runaway
// formula at scale.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { launchToolboxApp, closeToolboxApp } from "./support/launch-app";
import { openOperation, operationPanel } from "./support/operations";
import { selectPanel } from "./support/page-objects";
import {
  applyOperationWithBudget,
  expectValueCloseTo,
  openCaptureFromDisk,
  readReportedPixelNear,
  readVisibleToastTexts,
  REFERENCE_DIMENSIONS,
  REFERENCE_STACK_PATH,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
} from "./scale-audit.support";

const LOAD_BUDGET_MS = 180_000;
const RUN_BUDGET_MS = 300_000;
const APPLY_BUDGET_MS = 300_000;
const MAX_UI_GAP_MS = 5_000;

function referenceRamp(x: number, y: number): number {
  return (x % 100) + (y % 100);
}

interface ScriptRunObservation {
  readonly maxUiGapMs: number;
  readonly sawBusyFeedback: boolean;
}

// Fills the formula, clicks Run, and waits for the Run button to re-enable
// (isRunning drives disabled), measuring UI heartbeat gaps and watching for
// the viewport busy surface (progressbar or status overlay) while in flight.
async function runFormulaMeasuringInteractivity(
  page: Page,
  operationLabel: string,
  formulaFieldLabel: string,
  expression: string,
): Promise<ScriptRunObservation> {
  const panel = operationPanel(page, operationLabel);
  await panel.getByLabel(formulaFieldLabel, { exact: true }).fill(expression);
  await startUiHeartbeat(page);
  let sawBusyFeedback = false;
  const runButton = panel.getByRole("button", { name: "Run formula", exact: true });
  await runButton.click();
  await expect(runButton).toBeDisabled({ timeout: 15_000 });
  const deadline = Date.now() + RUN_BUDGET_MS;
  while (Date.now() < deadline && (await runButton.isDisabled())) {
    sawBusyFeedback = (await countBusySurfaces(page)) > 0 || sawBusyFeedback;
    await page.waitForTimeout(500);
  }
  await expect(runButton).toBeEnabled({ timeout: 1_000 });
  const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(page);
  await failOnScriptErrorToast(page);
  return { maxUiGapMs, sawBusyFeedback };
}

async function countBusySurfaces(page: Page): Promise<number> {
  const progressBars = await page.locator('[role="progressbar"]').count().catch(() => 0);
  const statusOverlays = await page.locator('[role="status"]').count().catch(() => 0);
  return progressBars + statusOverlays;
}

async function failOnScriptErrorToast(page: Page): Promise<void> {
  const toasts = await readVisibleToastTexts(page);
  const failure = toasts.find((text) => text.toLowerCase().includes("failed") || text.includes("exceeded"));
  if (failure) throw new Error(`Script run surfaced an error toast: ${failure}`);
}

test("VERIFY band weighting formula run + apply at reference scale", async () => {
  test.setTimeout(15 * 60_000);
  const launched = await launchToolboxApp();
  try {
    const loadMs = await openCaptureFromDisk(launched.window, REFERENCE_STACK_PATH, LOAD_BUDGET_MS);
    await openOperation(launched.window, "Band Weighting");
    const run = await runFormulaMeasuringInteractivity(
      launched.window,
      "Band Weighting",
      "Weight formula",
      "np.arange(1, 17)",
    );
    console.log(`VERIFY weighting loadMs=${loadMs} maxUiGapMs=${run.maxUiGapMs} busy=${run.sawBusyFeedback}`);
    expect(run.maxUiGapMs).toBeLessThan(MAX_UI_GAP_MS);
    expect(run.sawBusyFeedback).toBe(true);
    const panel = operationPanel(launched.window, "Band Weighting");
    await expect(panel.getByLabel("Weight for band 16", { exact: true })).toHaveValue("16");
    const applied = await applyOperationWithBudget(launched.window, "Band Weighting", APPLY_BUDGET_MS);
    console.log(`VERIFY weighting applyMs=${applied.applyMs} applyMaxGapMs=${applied.maxUiGapMs}`);
    await selectPanel(launched.window, 2);
    const pixel = await readReportedPixelNear(launched.window, 2, { x: 2450, y: 1850 }, REFERENCE_DIMENSIONS);
    expectValueCloseTo(pixel.value, 11000 + referenceRamp(pixel.x, pixel.y), 30, "weighted sum at reported pixel");
  } finally {
    await closeToolboxApp(launched).catch(() => launched.app.process().kill());
  }
});

test("VERIFY band selection formula run + apply at reference scale", async () => {
  test.setTimeout(15 * 60_000);
  const launched = await launchToolboxApp();
  try {
    await openCaptureFromDisk(launched.window, REFERENCE_STACK_PATH, LOAD_BUDGET_MS);
    await openOperation(launched.window, "Band Selection");
    const run = await runFormulaMeasuringInteractivity(
      launched.window,
      "Band Selection",
      "Band formula",
      "cube.max(axis=0)",
    );
    console.log(`VERIFY selection maxUiGapMs=${run.maxUiGapMs} busy=${run.sawBusyFeedback}`);
    expect(run.maxUiGapMs).toBeLessThan(MAX_UI_GAP_MS);
    const applied = await applyOperationWithBudget(launched.window, "Band Selection", APPLY_BUDGET_MS);
    console.log(`VERIFY selection applyMs=${applied.applyMs} applyMaxGapMs=${applied.maxUiGapMs}`);
    await selectPanel(launched.window, 2);
    const pixel = await readReportedPixelNear(launched.window, 2, { x: 2450, y: 1850 }, REFERENCE_DIMENSIONS);
    expectValueCloseTo(pixel.value, 16000 + referenceRamp(pixel.x, pixel.y), 30, "per-pixel max at reported pixel");
  } finally {
    await closeToolboxApp(launched).catch(() => launched.app.process().kill());
  }
});

test("VERIFY custom transform formula run + apply at reference scale", async () => {
  test.setTimeout(15 * 60_000);
  const launched = await launchToolboxApp();
  try {
    await openCaptureFromDisk(launched.window, REFERENCE_STACK_PATH, LOAD_BUDGET_MS);
    await openOperation(launched.window, "Custom Script");
    const run = await runFormulaMeasuringInteractivity(
      launched.window,
      "Custom Script",
      "Transform formula",
      "cube * 2",
    );
    console.log(`VERIFY transform maxUiGapMs=${run.maxUiGapMs} busy=${run.sawBusyFeedback}`);
    expect(run.maxUiGapMs).toBeLessThan(MAX_UI_GAP_MS);
    expect(run.sawBusyFeedback).toBe(true);
    const panel = operationPanel(launched.window, "Custom Script");
    await expect(panel.getByText("Transform ready: Formula (16 bands)", { exact: true })).toBeVisible();
    const applied = await applyOperationWithBudget(launched.window, "Custom Script", APPLY_BUDGET_MS);
    console.log(`VERIFY transform applyMs=${applied.applyMs} applyMaxGapMs=${applied.maxUiGapMs}`);
    await selectPanel(launched.window, 2);
    const pixel = await readReportedPixelNear(launched.window, 2, { x: 2450, y: 1850 }, REFERENCE_DIMENSIONS);
    expectValueCloseTo(pixel.value, 2 * (1000 + referenceRamp(pixel.x, pixel.y)), 30, "doubled band 1 at reported pixel");
  } finally {
    await closeToolboxApp(launched).catch(() => launched.app.process().kill());
  }
});

test("VERIFY the 30 s wall clock kills a runaway formula at reference scale", async () => {
  test.setTimeout(15 * 60_000);
  const launched = await launchToolboxApp();
  try {
    await openCaptureFromDisk(launched.window, REFERENCE_STACK_PATH, LOAD_BUDGET_MS);
    await openOperation(launched.window, "Band Weighting");
    const panel = operationPanel(launched.window, "Band Weighting");
    await panel.getByLabel("Weight formula", { exact: true }).fill("sum(float((cube + i).mean()) for i in range(10**6))");
    const runButton = panel.getByRole("button", { name: "Run formula", exact: true });
    const startedAt = Date.now();
    await runButton.click();
    await expect
      .poll(async () => (await readVisibleToastTexts(launched.window)).join(" | "), { timeout: 180_000 })
      .toContain("exceeded the 30-second limit");
    console.log(`VERIFY timeout surfaced after ${Date.now() - startedAt}ms`);
    await expect(runButton).toBeEnabled({ timeout: 30_000 });
  } finally {
    await closeToolboxApp(launched).catch(() => launched.app.process().kill());
  }
});
