import { describe, expect, it, vi } from "vitest";

import {
  listAllOperationCommands,
  OPERATION_MENUS,
} from "@shared/operation-menu-catalog";
import {
  buildToolbarOperationGroups,
  dispatchOperationCommand,
  findRegisteredActionById,
  type OperationCommandHandlers,
  type ToolbarOperationGroupContext,
} from "./operation-command-bindings";
import { REGISTERED_VIEWPORT_ACTIONS } from "./registered-actions";

function buildHandlerSpies(): OperationCommandHandlers & {
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {};
  const bump = (key: string) => () => {
    calls[key] = (calls[key] ?? 0) + 1;
  };
  return {
    calls,
    toggleRegionTool: bump("toggleRegionTool"),
    toggleMasks: bump("toggleMasks"),
    toggleBandSubset: bump("toggleBandSubset"),
    openActionPanel: bump("openActionPanel"),
    openNpcPanel: bump("openNpcPanel"),
    openCnrPanel: bump("openCnrPanel"),
    openRopPanel: bump("openRopPanel"),
    importCustomScript: bump("importCustomScript"),
    applyGeometricTransform: bump("applyGeometricTransform"),
  };
}

function buildToolbarContext(handlers: OperationCommandHandlers): ToolbarOperationGroupContext {
  return {
    handlers,
    getActionAvailability: () => ({ isAvailable: true }),
    regionToolActive: false,
    masksToolActive: false,
    bandSubsetToggle: { isAvailable: true, isActive: false, onToggle: () => {} },
    isQuickTransformAvailable: true,
  };
}

// CT-284: band-selection deliberately has no menu entry; it is reachable
// through the Subset Bands editor's "By function" mode. CT-352: custom-transform
// is reached from the hand-built Custom Script menu (src/main/menu.ts).
const ACTION_IDS_REACHABLE_OUTSIDE_THE_MENUS = new Set(["band-selection", "custom-transform"]);

describe("operation menu catalog wiring", () => {
  // CT-289 catalog completeness: the menu reorg must leave every registered
  // operation reachable from the catalog (menu or toolbar).
  it("keeps every registered action reachable from the catalog", () => {
    const reachableCommandIds = new Set(
      listAllOperationCommands()
        .filter((command) => command.showInMenu || command.showInToolbar)
        .map((command) => command.id),
    );
    for (const action of REGISTERED_VIEWPORT_ACTIONS) {
      if (ACTION_IDS_REACHABLE_OUTSIDE_THE_MENUS.has(action.id)) continue;
      expect(reachableCommandIds.has(action.id), `no catalog entry for "${action.id}"`).toBe(true);
    }
  });

  it("maps every open-action-panel command to a registered action with a matching label", () => {
    for (const command of listAllOperationCommands()) {
      if (command.behavior !== "open-action-panel") continue;
      const action = findRegisteredActionById(command.id);
      expect(action, `no registered action for command "${command.id}"`).not.toBeNull();
      expect(command.label).toBe(action?.label);
    }
  });

  it("opens the matching action panel for an open-action-panel command", () => {
    const handlers = buildHandlerSpies();
    const openSpy = vi.spyOn(handlers, "openActionPanel");
    dispatchOperationCommand("bit-shift", handlers);
    expect(openSpy).toHaveBeenCalledWith(findRegisteredActionById("bit-shift"));
  });

  // CT-352: the Custom Script menu's two panel items dispatch by id even
  // though neither command shows in an operation menu or on the toolbar.
  it("routes the Custom Script menu items to the panel and the script picker", () => {
    const handlers = buildHandlerSpies();
    const openSpy = vi.spyOn(handlers, "openActionPanel");
    dispatchOperationCommand("custom-transform", handlers);
    dispatchOperationCommand("custom-transform-import", handlers);
    expect(openSpy).toHaveBeenCalledWith(findRegisteredActionById("custom-transform"));
    expect(handlers.calls.importCustomScript).toBe(1);
  });

  it("routes toggle commands to their toggle handlers", () => {
    const handlers = buildHandlerSpies();
    dispatchOperationCommand("toggle-region-tool", handlers);
    dispatchOperationCommand("toggle-subset-bands", handlers);
    dispatchOperationCommand("toggle-masks", handlers);
    expect(handlers.calls.toggleRegionTool).toBe(1);
    expect(handlers.calls.toggleBandSubset).toBe(1);
    expect(handlers.calls.toggleMasks).toBe(1);
  });

  it("applies a geometric transform directly for a quick command", () => {
    const handlers = buildHandlerSpies();
    dispatchOperationCommand("rotate-90-cw", handlers);
    expect(handlers.calls.applyGeometricTransform).toBe(1);
  });

  it("ignores unknown command ids", () => {
    const handlers = buildHandlerSpies();
    dispatchOperationCommand("does-not-exist", handlers);
    expect(Object.keys(handlers.calls)).toHaveLength(0);
  });
});

describe("toolbar operation groups", () => {
  it("projects exactly the catalog groups that have toolbar commands", () => {
    const groups = buildToolbarOperationGroups(buildToolbarContext(buildHandlerSpies()));
    const catalogGroupKeysWithToolbarCommands = OPERATION_MENUS.flatMap((menu) => menu.groups)
      .filter((group) => group.commands.some((command) => command.showInToolbar))
      .map((group) => group.key);
    expect(groups.map((g) => g.key)).toEqual(catalogGroupKeysWithToolbarCommands);
  });

  it("keeps menu-only pipeline operations off the toolbar", () => {
    const groups = buildToolbarOperationGroups(buildToolbarContext(buildHandlerSpies()));
    const projectedIds = groups.flatMap((group) => group.items).map((item) => item.id);
    for (const menuOnlyId of ["pca", "normalize-data", "flat-field", "custom-transform"]) {
      expect(projectedIds).not.toContain(menuOnlyId);
    }
  });

  it("includes the four toolbar-only quick transform buttons in the transform group", () => {
    const groups = buildToolbarOperationGroups(buildToolbarContext(buildHandlerSpies()));
    const transform = groups.find((group) => group.key === "transform");
    const quickIds = transform?.items.filter((item) => item.kind === "quick").map((item) => item.id);
    expect(quickIds).toEqual(["rotate-90-cw", "rotate-270-cw", "flip-horizontal", "flip-vertical"]);
  });
});
