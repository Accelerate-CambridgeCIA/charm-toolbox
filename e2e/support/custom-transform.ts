import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";
import { runAsStoryboardStep } from "./storyboard-step";

// Page objects for the Custom Transform operation panel. The editor only
// CONFIGURES the transform: the formula field writes through as typed and
// Import script... picks a .py/.zip file without running it; the status line
// ("Formula set..." / "Tool loaded: ...") is the observable proof of the
// configuration. Apply is what RUNS the Python on the stack, so run
// completion is the busy overlay clearing. The panel stays open THROUGH the
// run and closes only on success (keepsPanelOpenUntilApplySucceeds): a failed
// run leaves it open, input intact, for correction and re-Apply.

export const CUSTOM_TRANSFORM_OPERATION_LABEL = "Custom Transform";

export const CUSTOM_TRANSFORM_FORMULA_SET_STATUS = "Formula set. Apply runs it on the stack.";

const CUSTOM_TRANSFORM_RUN_COMPLETION_TIMEOUT_MS = 60_000;
const CUSTOM_TRANSFORM_RUN_START_TIMEOUT_MS = 20_000;

function customTransformPanel(page: Page): Locator {
  return operationPanel(page, CUSTOM_TRANSFORM_OPERATION_LABEL);
}

export async function expectCustomTransformEditorReady(page: Page): Promise<void> {
  await expect(
    customTransformPanel(page).getByLabel("Transform formula", { exact: true }),
  ).toBeVisible();
}

// CT-349: the panel names the band-major cube shape so a script author does not
// assume (height, width, bands). Copy is the deliverable, so the DOM text is the oracle.
export const CUSTOM_TRANSFORM_CUBE_SHAPE_NOTE = "(bands, height, width)";

export async function expectCustomTransformShapeNoteVisible(page: Page): Promise<void> {
  await expect(
    customTransformPanel(page).getByText(CUSTOM_TRANSFORM_CUBE_SHAPE_NOTE, { exact: false }),
  ).toBeVisible();
}

export async function setCustomTransformFormula(page: Page, expression: string): Promise<void> {
  await customTransformPanel(page)
    .getByLabel("Transform formula", { exact: true })
    .fill(expression);
}

export async function clickImportCustomTransformScript(page: Page): Promise<void> {
  await customTransformPanel(page)
    .getByRole("button", { name: "Import script...", exact: true })
    .click();
}

export function loadedToolStatusText(fileName: string): string {
  return `Tool loaded: ${fileName}. Apply runs it on the stack.`;
}

export async function expectCustomTransformConfigured(
  page: Page,
  expectedStatusText: string,
): Promise<void> {
  await expect(
    customTransformPanel(page).getByText(expectedStatusText, { exact: true }),
  ).toBeVisible();
}

// Apply starts the Python run: the result panel's busy overlay appears while
// the cube uploads and the worker executes, and clears when the transformed
// stack lands (or the run fails). The panel itself stays visible throughout.
export async function applyCustomTransformAwaitingRun(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Apply the custom transform and wait for the run", async () => {
    const panel = customTransformPanel(page);
    await panel.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(customTransformRunBusyOverlays(page).first()).toBeVisible({
      timeout: CUSTOM_TRANSFORM_RUN_START_TIMEOUT_MS,
    });
    await expect(customTransformRunBusyOverlays(page)).toHaveCount(0, {
      timeout: CUSTOM_TRANSFORM_RUN_COMPLETION_TIMEOUT_MS,
    });
  });
}

export async function expectCustomTransformPanelClosed(page: Page): Promise<void> {
  await expect(customTransformPanel(page)).toBeHidden();
}

export async function expectCustomTransformPanelStillOpen(page: Page): Promise<void> {
  await expect(customTransformPanel(page)).toBeVisible();
}

export function customTransformFailureToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: /Custom Transform failed/i });
}

function customTransformRunBusyOverlays(page: Page): Locator {
  return page
    .getByRole("grid", { name: "Panel grid" })
    .locator('[role="status"]')
    .filter({ has: page.locator("svg.animate-spin") });
}
