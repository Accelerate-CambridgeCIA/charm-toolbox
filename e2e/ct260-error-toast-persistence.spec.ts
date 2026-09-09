import { expect, test } from "@playwright/test";

import { E2E_MEMORY_BUDGET_ENVIRONMENT_VARIABLE } from "../src/shared/e2e-memory-budget-argument";
import { fixturePath, multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import { enqueueAndTriggerOpenImages } from "./support/open-images-flow";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-260: error toasts persist until dismissed, so a user hitting a memory
// refusal can actually read it. The launch lowers the raster-memory budget
// (MSI_E2E_MEMORY_BUDGET_BYTES, the CT-260 test surface) below the fixture's
// file size, so opening multiband-12bit.tif takes the REAL open-flow memory
// refusal path at tiny scale. Oracle: the toast locator's visibility over
// time - visible well past sonner's default auto-dismiss, then hidden only
// after its close button is clicked.

const BUDGET_BYTES_BELOW_THE_FIXTURE_FILE_SIZE = "100";

// Sonner's default toast lifetime is 4 s; a toast still visible after 6 s
// cannot be auto-dismissing.
const AUTO_DISMISS_GRACE_MS = 6_000;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp({
    extraEnvironment: {
      [E2E_MEMORY_BUDGET_ENVIRONMENT_VARIABLE]: BUDGET_BYTES_BELOW_THE_FIXTURE_FILE_SIZE,
    },
  });
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a memory-refusal error toast outlives auto-dismiss and closes via its Dismiss button", async () => {
  const page = launched.window;
  await enqueueAndTriggerOpenImages(page, [fixturePath(multiBandTiff.fileName)]);

  const refusalToast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "There is not enough memory" });

  await runAsStoryboardStep(page, "The refused open raises the memory-refusal error toast", async () => {
    await expect(refusalToast).toBeVisible();
    await expect(refusalToast).toContainText(multiBandTiff.fileName);
  });

  await runAsStoryboardStep(page, "The toast is still visible after the auto-dismiss window", async () => {
    await page.waitForTimeout(AUTO_DISMISS_GRACE_MS);
    await expect(refusalToast).toBeVisible();
  });

  await runAsStoryboardStep(page, "The Dismiss button dismisses the toast", async () => {
    await refusalToast.getByRole("button", { name: "Dismiss" }).click();
    await expect(refusalToast).toBeHidden();
  });
});
