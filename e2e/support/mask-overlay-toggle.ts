import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { panelCell } from "./panels";

// CT-343: the per-panel header "Show masks" toggle only renders once the panel
// carries at least one mask layer, matching the CT-259-style label prefix
// pattern the normalized-viewing toggle already uses ("Show masks" / "Show
// masks (on)"), scoped to the panel cell so every panel can reuse the name.

export function maskOverlayToggle(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).getByRole("button", { name: /^Show masks/ });
}

export async function toggleMaskOverlayVisibility(page: Page, panelNumber: number): Promise<void> {
  await maskOverlayToggle(page, panelNumber).click();
}

export async function expectMaskOverlayToggleEnabled(
  page: Page,
  panelNumber: number,
  enabled: boolean,
): Promise<void> {
  await expect(maskOverlayToggle(page, panelNumber)).toHaveAttribute(
    "aria-pressed",
    String(enabled),
  );
}
