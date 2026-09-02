import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Panels are role="gridcell" cells inside the role="grid" "Panel grid"; each
// viewport canvas is role="img" labelled "Panel N" (1-based). Selection is a
// plain click that sets aria-selected on the cell.

export function panelGrid(page: Page): Locator {
  return page.getByRole("grid", { name: "Panel grid" });
}

export function panelCell(page: Page, panelNumber: number): Locator {
  return panelGrid(page).getByRole("gridcell").nth(panelNumber - 1);
}

export function panelCanvas(page: Page, panelNumber: number): Locator {
  // The viewport canvas carries only aria-label (no role="img" like the histogram
  // canvas), so select it by tag + aria-label rather than by role.
  return page.locator(`canvas[aria-label="Panel ${panelNumber}"]`);
}

// CT-331: the mask overlay canvas renders only while its panel is SELECTED,
// the Masks tool is active, and a covering layer is selected on it.
export function viewportMaskOverlay(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).getByTestId("viewport-mask-overlay");
}

export async function selectPanel(page: Page, panelNumber: number): Promise<void> {
  await panelCell(page, panelNumber).click();
  await expect(panelCell(page, panelNumber)).toHaveAttribute("aria-selected", "true");
}

export async function countSelectedPanels(page: Page): Promise<number> {
  return panelGrid(page).getByRole("gridcell", { selected: true }).count();
}

export async function countPanels(page: Page): Promise<number> {
  return panelGrid(page).getByRole("gridcell").count();
}

export interface PanelSelectionClickModifiers {
  readonly ctrlOrMeta?: boolean;
  readonly shift?: boolean;
}

// Click near the cell's top-left corner (its number-badge strip) so the gridcell's
// own onClick selection fires without hitting the centred empty-state "Open image"
// button or the canvas pixel-pin handler (which forces a plain selection on
// multi-band rasters). Selection is a gridcell concern, so this works on empty and
// loaded panels alike.
const PANEL_SELECT_CLICK_POSITION = { x: 8, y: 8 } as const;

type PlaywrightModifierKey = "ControlOrMeta" | "Shift";

function toPlaywrightClickModifiers(
  modifiers: PanelSelectionClickModifiers,
): ReadonlyArray<PlaywrightModifierKey> {
  const keys: PlaywrightModifierKey[] = [];
  if (modifiers.ctrlOrMeta) keys.push("ControlOrMeta");
  if (modifiers.shift) keys.push("Shift");
  return keys;
}

export async function clickPanelToSelect(
  page: Page,
  panelNumber: number,
  modifiers: PanelSelectionClickModifiers = {},
): Promise<void> {
  await panelCell(page, panelNumber).click({
    position: { ...PANEL_SELECT_CLICK_POSITION },
    modifiers: [...toPlaywrightClickModifiers(modifiers)],
  });
}

export async function expectPanelShowsSelectionRing(
  page: Page,
  panelNumber: number,
): Promise<void> {
  await expect(panelCell(page, panelNumber)).toHaveClass(/ring-2/);
}

export async function expectOnlyPanelsSelected(
  page: Page,
  selectedPanelNumbers: ReadonlyArray<number>,
): Promise<void> {
  const panelCount = await countPanels(page);
  for (let panelNumber = 1; panelNumber <= panelCount; panelNumber++) {
    const expectedAriaSelected = selectedPanelNumbers.includes(panelNumber) ? "true" : "false";
    await expect(panelCell(page, panelNumber)).toHaveAttribute("aria-selected", expectedAriaSelected);
  }
}

export async function clickGridBackgroundToClearSelection(page: Page): Promise<void> {
  const gridBox = await panelGrid(page).boundingBox();
  if (!gridBox) throw new Error("Panel grid is not visible");
  await page.mouse.click(gridBox.x - 8, gridBox.y + gridBox.height / 2);
}
