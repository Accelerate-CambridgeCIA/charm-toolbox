import { describe, expect, it } from "vitest";
import { BoxSelect, FolderInput, FolderOpen, Grid2x2 } from "lucide-react";

import {
  buildToolbarOperationGroups,
  CNR_PANEL_ICON,
  MASKS_TOGGLE_ICON,
  NPC_PANEL_ICON,
  QUICK_TRANSFORM_ICONS,
  ROP_PANEL_ICON,
  type ToolbarOperationGroupContext,
} from "./operation-command-bindings";
import {
  BAND_SUBSET_ACTION,
  REGISTERED_VIEWPORT_ACTIONS,
  type RegisteredActionIcon,
} from "./registered-actions";
import { DUPLICATE_BANDS_ACTION } from "./duplicate-bands-action";

// One icon, one meaning, app-wide: two different operations must never share an
// icon component, even when only one of them currently shows a toolbar button
// (showInToolbar flags change over time, which is how the old RotateCw and
// FlipHorizontal collisions crept in). Toolbar chrome (Open, Grid layout) and
// the region-tool toggle are included so operations cannot collide with them
// either. The Subset Bands toggle is deliberately NOT a separate entry: it
// derives its icon from BAND_SUBSET_ACTION because it is the same operation.

const TOOLBAR_CHROME_AND_TOGGLE_ICONS: ReadonlyArray<[string, RegisteredActionIcon]> = [
  ["open-image", FolderOpen],
  ["open-project", FolderInput],
  ["grid-layout", Grid2x2],
  ["toggle-region-tool", BoxSelect],
  ["toggle-masks", MASKS_TOGGLE_ICON],
  ["npc", NPC_PANEL_ICON],
  // CT-320: CNR is its own Multi-band tool, so its aside header icon is tracked
  // here alongside NPC's.
  ["cnr", CNR_PANEL_ICON],
  // CT-309: the ROP aside and the kept-projection action share this icon on
  // purpose (same operation); the uniqueness sweep tracks it once under "rop".
  ["rop", ROP_PANEL_ICON],
];

function listEveryIconAssignment(): Array<[string, RegisteredActionIcon]> {
  return [
    ...REGISTERED_VIEWPORT_ACTIONS.map(
      (action): [string, RegisteredActionIcon] => [action.id, action.icon],
    ),
    [BAND_SUBSET_ACTION.id, BAND_SUBSET_ACTION.icon],
    [DUPLICATE_BANDS_ACTION.id, DUPLICATE_BANDS_ACTION.icon],
    ...Object.entries(QUICK_TRANSFORM_ICONS),
    ...TOOLBAR_CHROME_AND_TOGGLE_ICONS,
  ];
}

function groupOwnerIdsByIcon(): Map<RegisteredActionIcon, string[]> {
  const ownersByIcon = new Map<RegisteredActionIcon, string[]>();
  for (const [id, icon] of listEveryIconAssignment()) {
    ownersByIcon.set(icon, [...(ownersByIcon.get(icon) ?? []), id]);
  }
  return ownersByIcon;
}

function buildIdleToolbarContext(): ToolbarOperationGroupContext {
  return {
    handlers: {
      toggleRegionTool: () => {},
      toggleMasks: () => {},
      toggleBandSubset: () => {},
      openActionPanel: () => {},
      openNpcPanel: () => {},
      openCnrPanel: () => {},
      openRopPanel: () => {},
      importCustomScript: () => {},
      applyGeometricTransform: () => {},
    },
    getActionAvailability: () => ({ isAvailable: true }),
    regionToolActive: false,
    masksToolActive: false,
    bandSubsetToggle: { isAvailable: true, isActive: false, onToggle: () => {} },
    isQuickTransformAvailable: true,
  };
}

function findProjectedSubsetBandsToggleIcon(): RegisteredActionIcon | undefined {
  const items = buildToolbarOperationGroups(buildIdleToolbarContext())
    .flatMap((group) => group.items)
    .filter((item) => item.kind === "toggle");
  const toggle = items.find((item) => item.id === "toggle-subset-bands");
  return toggle && "icon" in toggle ? toggle.icon : undefined;
}

describe("operation icon uniqueness", () => {
  it("assigns every icon to exactly one operation or control", () => {
    const shared = [...groupOwnerIdsByIcon().values()].filter((ids) => ids.length > 1);
    expect(shared, `icon shared by: ${JSON.stringify(shared)}`).toEqual([]);
  });

  it("keeps the subset-bands toggle on the same icon as its action panel", () => {
    expect(findProjectedSubsetBandsToggleIcon()).toBe(BAND_SUBSET_ACTION.icon);
  });
});
