import { describe, expect, it } from "vitest";

import {
  listAllOperationCommands,
  listMenuCommandsAlphabetically,
  OPERATION_MENUS,
  type OperationMenu,
} from "./operation-menu-catalog";

function listMenuItemLabels(menu: OperationMenu): string[] {
  return listMenuCommandsAlphabetically(menu).map((command) => command.label);
}

function findMenuByLabel(menuLabel: string): OperationMenu {
  const menu = OPERATION_MENUS.find((candidate) => candidate.menuLabel === menuLabel);
  if (!menu) throw new Error(`no operation menu labelled "${menuLabel}"`);
  return menu;
}

describe("operation menu structure (CT-289 Jul 30 meeting list)", () => {
  it("orders the operation menus Tools, Basic Processing, Multi-band", () => {
    expect(OPERATION_MENUS.map((menu) => menu.menuLabel)).toEqual([
      "Tools",
      "Basic Processing",
      "Multi-band",
    ]);
  });

  // Operation menus present flat and alphabetical (no separators), so each
  // expectation below is the exact list a user sees, in order.
  it("puts selection, geometry, stack preparation, and analysis tools under Tools", () => {
    expect(listMenuItemLabels(findMenuByLabel("Tools"))).toEqual([
      "Bit Shift",
      "CNR",
      "Crop to Region",
      "Flat-field Correction",
      "Flip",
      "Masks",
      "NPC",
      "RGB to Grayscale",
      "Rotate",
      "Select Region",
      "Spectralon Calibration",
      "Subset Bands",
    ]);
  });

  it("puts per-pixel and per-band value processing under Basic Processing", () => {
    expect(listMenuItemLabels(findMenuByLabel("Basic Processing"))).toEqual([
      "Brightness & Contrast",
      "Clip by Value",
      "Contrast Curve",
      "Custom Transform",
      "Denoise",
      "Frequency Filters",
      "Invert",
      "Normalize",
      "Percentile Clip",
      "Standardize",
      "Threshold",
    ]);
  });

  it("puts cross-band and whole-cube operations under Multi-band", () => {
    expect(listMenuItemLabels(findMenuByLabel("Multi-band"))).toEqual([
      "Concatenate Stacks",
      "ICA",
      "L2 Minimization",
      "Local MNF",
      "Local PCA",
      "MNF",
      "PCA",
      "RGB Color Composite",
      "ROP",
      "Spectral Derivative",
      "Weighted Sum",
    ]);
  });

  it("sorts every operation menu's items alphabetically", () => {
    for (const menu of OPERATION_MENUS) {
      const labels = listMenuItemLabels(menu);
      expect(labels, menu.menuLabel).toEqual(
        [...labels].sort((a, b) => a.localeCompare(b)),
      );
    }
  });
});

describe("toolbar allowlist", () => {
  // The toolbar rule: mode toggles, zero-parameter one-click applies, and the
  // everyday panel-openers. Parameterized pipeline operations are menu-only.
  it("marks exactly the allowed commands showInToolbar", () => {
    const toolbarIds = listAllOperationCommands()
      .filter((command) => command.showInToolbar)
      .map((command) => command.id);
    expect(toolbarIds).toEqual([
      "toggle-region-tool",
      "toggle-subset-bands",
      "toggle-masks",
      "crop-to-region",
      "rotate-90-cw",
      "rotate-270-cw",
      "flip-horizontal",
      "flip-vertical",
      "tone-curve",
      "brightness-contrast",
    ]);
  });
});

describe("catalog integrity", () => {
  it("never reuses a command id or label", () => {
    const commands = listAllOperationCommands();
    const ids = commands.map((command) => command.id);
    const labels = commands.map((command) => command.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
