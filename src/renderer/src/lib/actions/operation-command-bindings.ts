import {
  BoxSelect,
  Brush,
  Dices,
  FlipHorizontal,
  FlipVertical,
  Gauge,
  RotateCcw,
  RotateCw,
  SignalHigh,
  type LucideIcon,
} from "lucide-react";

import {
  OPERATION_MENUS,
  findOperationCommandById,
  type OperationCommand,
  type OperationGroup,
} from "@shared/operation-menu-catalog";
import {
  isGeometricTransform,
  type GeometricTransform,
} from "@/lib/image/apply-geometric-transform";
import {
  BAND_SUBSET_ACTION,
  REGISTERED_VIEWPORT_ACTIONS,
  type RegisteredActionIcon,
  type RegisteredViewportAction,
} from "@/lib/actions/registered-actions";
import type {
  ActionAvailabilityForActiveViewport,
  BandSubsetToolbarToggleState,
} from "@/components/toolbar";

// The catalog (shared, pure data) describes WHAT each operation command is and
// where it appears. This module binds those commands to renderer behaviour: it
// dispatches menu-bar clicks and projects the same commands into grouped
// toolbar items so the two surfaces never drift.

export interface OperationCommandHandlers {
  readonly toggleRegionTool: () => void;
  readonly toggleMasks: () => void;
  readonly toggleBandSubset: () => void;
  readonly openActionPanel: (action: RegisteredViewportAction) => void;
  readonly openNpcPanel: () => void;
  readonly openCnrPanel: () => void;
  readonly openRopPanel: () => void;
  // CT-352: Custom Script > Import Script... opens the Custom Script panel and
  // launches the script picker in one go.
  readonly importCustomScript: () => void;
  readonly applyGeometricTransform: (transform: GeometricTransform) => void;
}

export function dispatchOperationCommand(
  commandId: string,
  handlers: OperationCommandHandlers,
): void {
  const command = findOperationCommandById(commandId);
  if (command) runOperationCommandBehavior(command, handlers);
}

function runOperationCommandBehavior(
  command: OperationCommand,
  handlers: OperationCommandHandlers,
): void {
  switch (command.behavior) {
    case "toggle-region-tool":
      return handlers.toggleRegionTool();
    case "toggle-masks":
      return handlers.toggleMasks();
    case "toggle-subset-bands":
      return handlers.toggleBandSubset();
    case "open-action-panel":
      return openActionPanelForCommand(command, handlers);
    case "open-npc-panel":
      return handlers.openNpcPanel();
    case "open-cnr-panel":
      return handlers.openCnrPanel();
    case "open-rop-panel":
      return handlers.openRopPanel();
    case "import-custom-script":
      return handlers.importCustomScript();
    case "apply-geometric-transform":
      return applyGeometricTransformForCommand(command, handlers);
  }
}

function openActionPanelForCommand(
  command: OperationCommand,
  handlers: OperationCommandHandlers,
): void {
  const action = findRegisteredActionById(command.id);
  if (action) handlers.openActionPanel(action);
}

function applyGeometricTransformForCommand(
  command: OperationCommand,
  handlers: OperationCommandHandlers,
): void {
  const transform = command.geometricTransform;
  if (isGeometricTransform(transform)) handlers.applyGeometricTransform(transform);
}

export function findRegisteredActionById(
  actionId: string,
): RegisteredViewportAction | null {
  return REGISTERED_VIEWPORT_ACTIONS.find((action) => action.id === actionId) ?? null;
}

export type ToolbarOperationItem =
  | {
      readonly kind: "toggle";
      readonly id: string;
      readonly label: string;
      readonly icon: RegisteredActionIcon;
      readonly isActive: boolean;
      readonly isAvailable: boolean;
      readonly unavailableHint?: string;
      readonly onToggle: () => void;
    }
  | {
      readonly kind: "action";
      readonly id: string;
      readonly action: RegisteredViewportAction;
      readonly availability: ActionAvailabilityForActiveViewport;
      readonly onInvoke: () => void;
    }
  | {
      readonly kind: "quick";
      readonly id: string;
      readonly label: string;
      readonly icon: RegisteredActionIcon;
      readonly isAvailable: boolean;
      readonly onInvoke: () => void;
    };

export interface ToolbarOperationGroup {
  readonly key: string;
  readonly items: ReadonlyArray<ToolbarOperationItem>;
}

export interface ToolbarOperationGroupContext {
  readonly handlers: OperationCommandHandlers;
  readonly getActionAvailability: (
    action: RegisteredViewportAction,
  ) => ActionAvailabilityForActiveViewport;
  readonly regionToolActive: boolean;
  readonly masksToolActive: boolean;
  readonly bandSubsetToggle: BandSubsetToolbarToggleState;
  readonly isQuickTransformAvailable: boolean;
}

// Exported so the icon-uniqueness test can assert no operation shares an icon
// with a quick-transform button.
export const QUICK_TRANSFORM_ICONS: Record<string, LucideIcon> = {
  "rotate-90-cw": RotateCw,
  "rotate-270-cw": RotateCcw,
  "flip-horizontal": FlipHorizontal,
  "flip-vertical": FlipVertical,
};

// Exported so the icon-uniqueness test and the Masks aside header share one
// icon assignment for the masks tool.
export const MASKS_TOGGLE_ICON: LucideIcon = Brush;

// Exported so the icon-uniqueness test and the NPC aside header share one icon
// assignment for the score analysis (CT-308).
export const NPC_PANEL_ICON: LucideIcon = Gauge;

// Exported so the icon-uniqueness test and the CNR aside header share one icon
// assignment for the contrast-to-noise analysis (CT-320). Not Contrast: the
// Threshold operation already owns that one, and one icon means one operation.
export const CNR_PANEL_ICON: LucideIcon = SignalHigh;

// Exported so the icon-uniqueness test, the ROP aside header, and the kept
// projection's action share one icon assignment (CT-309); the aside and the
// keep action are the same operation, so sharing is deliberate (CT-295 rule).
export const ROP_PANEL_ICON: LucideIcon = Dices;

const SUBSET_BANDS_UNAVAILABLE_HINT = "select a multi-band stack";

export function buildToolbarOperationGroups(
  context: ToolbarOperationGroupContext,
): ToolbarOperationGroup[] {
  return OPERATION_MENUS.flatMap((menu) => menu.groups)
    .map((group) => buildToolbarOperationGroup(group, context))
    .filter((group) => group.items.length > 0);
}

function buildToolbarOperationGroup(
  group: OperationGroup,
  context: ToolbarOperationGroupContext,
): ToolbarOperationGroup {
  const items = group.commands
    .filter((command) => command.showInToolbar)
    .map((command) => buildToolbarOperationItem(command, context))
    .filter((item): item is ToolbarOperationItem => item !== null);
  return { key: group.key, items };
}

function buildToolbarOperationItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem | null {
  switch (command.behavior) {
    case "toggle-region-tool":
      return buildRegionToggleItem(command, context);
    case "toggle-masks":
      return buildMasksToggleItem(command, context);
    case "toggle-subset-bands":
      return buildBandSubsetToggleItem(command, context);
    case "open-action-panel":
      return buildActionItem(command, context);
    // CT-308/CT-309: the analysis panels are menu-only, so they project no
    // toolbar items.
    case "open-npc-panel":
      return null;
    case "open-cnr-panel":
      return null;
    case "open-rop-panel":
      return null;
    case "import-custom-script":
      return null;
    case "apply-geometric-transform":
      return buildQuickTransformItem(command, context);
  }
}

function buildRegionToggleItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem {
  return {
    kind: "toggle",
    id: command.id,
    label: command.label,
    icon: BoxSelect,
    isActive: context.regionToolActive,
    isAvailable: true,
    onToggle: context.handlers.toggleRegionTool,
  };
}

// CT-302: the Masks toggle opens the Masks options aside for the active panel.
// It is always offered; the aside itself explains when no panel is selected.
function buildMasksToggleItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem {
  return {
    kind: "toggle",
    id: command.id,
    label: command.label,
    icon: MASKS_TOGGLE_ICON,
    isActive: context.masksToolActive,
    isAvailable: true,
    onToggle: context.handlers.toggleMasks,
  };
}

function buildBandSubsetToggleItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem {
  return {
    kind: "toggle",
    id: command.id,
    label: command.label,
    // Same operation as the band-subset action panel, so it shares that icon.
    icon: BAND_SUBSET_ACTION.icon,
    isActive: context.bandSubsetToggle.isActive,
    isAvailable: context.bandSubsetToggle.isAvailable,
    unavailableHint: SUBSET_BANDS_UNAVAILABLE_HINT,
    onToggle: context.handlers.toggleBandSubset,
  };
}

function buildActionItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem | null {
  const action = findRegisteredActionById(command.id);
  if (!action) return null;
  return {
    kind: "action",
    id: command.id,
    action,
    availability: context.getActionAvailability(action),
    onInvoke: () => context.handlers.openActionPanel(action),
  };
}

function buildQuickTransformItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem | null {
  const transform = command.geometricTransform;
  if (!isGeometricTransform(transform)) return null;
  return {
    kind: "quick",
    id: command.id,
    label: command.label,
    icon: QUICK_TRANSFORM_ICONS[command.id] ?? RotateCw,
    isAvailable: context.isQuickTransformAvailable,
    onInvoke: () => context.handlers.applyGeometricTransform(transform),
  };
}
