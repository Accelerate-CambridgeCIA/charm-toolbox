import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { applicationToolbar } from "./operations";
import { runAsStoryboardStep } from "./storyboard-step";

// CT-302: "Masks" is a mode toggle on the toolbar (and in the Tools menu). It
// opens an <aside aria-label="Masks options"> for the ACTIVE panel listing that
// panel's mask layers, the selected layer's categories (max five), and the
// layer opacity.

export const MASKS_TOOL_LABEL = "Masks";
export const MASKS_REMOVED_TOAST_TEXT =
  "Masks were removed because the stack's geometry changed";
export const MAX_MASK_CATEGORIES = 5;

export function masksOptionsPanel(page: Page): Locator {
  return page.locator('aside[aria-label="Masks options"]');
}

function masksToolbarToggle(page: Page, isActive: boolean): Locator {
  const name = isActive ? `${MASKS_TOOL_LABEL} (active)` : MASKS_TOOL_LABEL;
  return applicationToolbar(page).getByRole("button", { name, exact: true });
}

export async function openMasksOptions(page: Page): Promise<Locator> {
  return runAsStoryboardStep(page, "Open the Masks options aside from the toolbar", async () => {
    await masksToolbarToggle(page, false).click();
    const panel = masksOptionsPanel(page);
    await expect(panel).toBeVisible();
    return panel;
  });
}

// CT-345: opening a competing right-side panel turns the Masks TOOL off, not
// just the aside, so the toolbar toggle is the oracle for the tool state.
export function masksToolbarToggleInEitherState(page: Page): Locator {
  return applicationToolbar(page).getByRole("button", { name: /^Masks( \(active\))?$/ });
}

export async function expectMasksToolActive(page: Page, isActive: boolean): Promise<void> {
  await expect(masksToolbarToggleInEitherState(page)).toHaveAttribute(
    "aria-pressed",
    String(isActive),
  );
}

export async function closeMasksOptions(page: Page): Promise<void> {
  await masksToolbarToggle(page, true).click();
  await expect(masksOptionsPanel(page)).toBeHidden();
}

// Scoped to the layer list: CT-304 added a second single-choice ToggleGroup
// (the brush category), whose items are radios in the same aside.
export function maskLayerOptions(page: Page): Locator {
  return masksOptionsPanel(page).locator('[aria-label="Mask layers"]').getByRole("radio");
}

export function maskLayerNameField(page: Page): Locator {
  return masksOptionsPanel(page).getByRole("textbox", { name: "Layer name" });
}

export function maskCategoryNameField(page: Page, position: number): Locator {
  return masksOptionsPanel(page).getByRole("textbox", { name: `Category ${position} name` });
}

// CT-328: the round trip has to prove the category COLOURS survived, so the
// swatch (an <input type="color"> whose value is the hex) is a readout too.
export function maskCategoryColorField(page: Page, position: number): Locator {
  return masksOptionsPanel(page).getByLabel(`Category ${position} color`);
}

// CT-332: the name pattern has to exclude "Add category from file", the second
// button beside this one; this button's accessible name ends in its N/5 count.
export function addMaskCategoryButton(page: Page): Locator {
  return masksOptionsPanel(page).getByRole("button", { name: /^Add category \d+\/\d+$/ });
}

// Radix puts the aria-label on the slider ROOT and role="slider" (with
// aria-valuenow) on the thumb inside it, so reach the thumb through the root.
export function maskLayerOpacitySlider(page: Page): Locator {
  return masksOptionsPanel(page).locator('[aria-label="Layer opacity"]').getByRole("slider");
}

export async function createMaskLayer(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Create a mask layer on the active panel", async () => {
    const before = await maskLayerOptions(page).count();
    await masksOptionsPanel(page).getByRole("button", { name: "New layer", exact: true }).click();
    await expect(maskLayerOptions(page)).toHaveCount(before + 1);
  });
}

export async function renameMaskCategory(
  page: Page,
  position: number,
  name: string,
): Promise<void> {
  await runAsStoryboardStep(page, `Rename category ${position} to "${name}"`, async () => {
    await maskCategoryNameField(page, position).fill(name);
    await expect(maskCategoryNameField(page, position)).toHaveValue(name);
  });
}

// Clicks Add category until the control disables itself, then reports how many
// categories the layer ended up with.
export async function addMaskCategoriesUntilTheControlDisables(page: Page): Promise<number> {
  return runAsStoryboardStep(page, "Add categories until the control disables", async () => {
    while (await addMaskCategoryButton(page).isEnabled()) {
      await addMaskCategoryButton(page).click();
    }
    return maskCategoryNameFields(page).count();
  });
}

export function maskCategoryNameFields(page: Page): Locator {
  return masksOptionsPanel(page).locator('input[aria-label^="Category "][aria-label$=" name"]');
}

export function masksRemovedToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: MASKS_REMOVED_TOAST_TEXT });
}
