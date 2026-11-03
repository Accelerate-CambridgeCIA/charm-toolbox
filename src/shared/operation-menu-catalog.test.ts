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
  // CT-352 (Oct 28 feedback): Concatenate Stacks joins Tools; RGB to
  // Grayscale, Flat-field and Spectralon leave it; NPC reads "Potential
  // Contrast".
  it("puts selection, geometry, stack preparation, stack combining, and analysis tools under Tools", () => {
    expect(listMenuItemLabels(findMenuByLabel("Tools"))).toEqual([
      "Bit Shift",
      "CNR",
      "Concatenate Stacks",
      "Crop to Region",
      "Flip",
      "Masks",
      "Potential Contrast",
      "Rotate",
      "Select Region",
      "Subset Bands",
    ]);
  });

  it("puts per-pixel and per-band value processing, including the reference corrections, under Basic Processing", () => {
    expect(listMenuItemLabels(findMenuByLabel("Basic Processing"))).toEqual([
      "Brightness & Contrast",
      "Clip by Value",
      "Contrast Curve",
      "Denoise",
      "Flat-field Correction",
      "Frequency Filters",
      "Invert",
      "Normalize",
      "Percentile Clip",
      "Spectralon Calibration",
      "Standardize",
      "Threshold",
    ]);
  });

  it("puts cross-band and whole-cube operations under Multi-band", () => {
    expect(listMenuItemLabels(findMenuByLabel("Multi-band"))).toEqual([
      "ICA",
      "L2 Minimization",
      "Local MNF",
      "Local PCA",
      "MNF",
      "PCA",
      "Random Projections",
      "RGB Color Composite",
      "RGB to Grayscale",
      "Spectral Derivative",
      "Weighted Sum",
    ]);
  });

  // CT-352: the Custom Script panel is reached from the hand-built top-level
  // Custom Script menu (src/main/menu.ts), never from an operation menu or the
  // toolbar, so its two commands are hidden from both projections.
  it("keeps the Custom Script commands out of every operation menu and off the toolbar", () => {
    const hidden = listAllOperationCommands().filter(
      (command) => command.id === "custom-transform" || command.id === "custom-transform-import",
    );
    expect(hidden.map((command) => command.label)).toEqual(["Custom Script", "Import Script..."]);
    for (const command of hidden) {
      expect(command.showInMenu).toBe(false);
      expect(command.showInToolbar).toBe(false);
    }
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
