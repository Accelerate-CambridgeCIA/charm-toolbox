// Single source of truth for the operation menus (Tools, Basic Processing,
// Multi-band; CT-289 reorg from the Jul 30 meeting list).
//
// Both the native application menu (main process) and the React toolbar
// (renderer) derive their structure from this catalog so the two surfaces stay
// in sync: every operation in the menu bar is reachable, and the toolbar is a
// regrouped projection of the same commands plus a few toolbar-only quick
// variants that apply directly without opening a side panel.
//
// Toolbar rule: a command is showInToolbar only if it is a mode toggle
// (Select Region, Subset Bands), a one-click direct apply with zero
// parameters (the quick rotate/flip variants), or an everyday panel-opener
// used in essentially every session (Crop, Contrast Curve, Brightness &
// Contrast). Parameterized pipeline operations are menu-only.
//
// Groups drive the TOOLBAR separators only. The native operation menus are
// presented flat and alphabetically (listMenuCommandsAlphabetically), with no
// separators, so users can find an operation by name.
//
// This module is intentionally pure data: no DOM, no Electron, no React. Icons
// and behaviour bindings live in the renderer because they are environment
// specific; this file only describes labels, grouping, and intent.

export type OperationCommandBehavior =
  | "toggle-region-tool"
  | "toggle-masks"
  | "toggle-subset-bands"
  | "open-action-panel"
  | "open-npc-panel"
  | "open-cnr-panel"
  | "open-rop-panel"
  | "apply-geometric-transform";

export interface OperationCommand {
  readonly id: string;
  readonly label: string;
  readonly behavior: OperationCommandBehavior;
  // Present only when behavior is "apply-geometric-transform"; the value is a
  // GeometricTransform literal validated on the renderer side.
  readonly geometricTransform?: string;
  readonly showInMenu: boolean;
  readonly showInToolbar: boolean;
}

export interface OperationGroup {
  readonly key: string;
  readonly commands: ReadonlyArray<OperationCommand>;
}

export interface OperationMenu {
  readonly menuLabel: string;
  readonly groups: ReadonlyArray<OperationGroup>;
}

function buildMenuAndToolbarCommand(
  id: string,
  label: string,
  behavior: OperationCommandBehavior,
): OperationCommand {
  return { id, label, behavior, showInMenu: true, showInToolbar: true };
}

function buildMenuOnlyActionCommand(id: string, label: string): OperationCommand {
  return { id, label, behavior: "open-action-panel", showInMenu: true, showInToolbar: false };
}

function buildToolbarOnlyTransformCommand(
  geometricTransform: string,
  label: string,
): OperationCommand {
  return {
    id: geometricTransform,
    label,
    behavior: "apply-geometric-transform",
    geometricTransform,
    showInMenu: false,
    showInToolbar: true,
  };
}

const SELECTION_GROUP: OperationGroup = {
  key: "selection",
  commands: [
    buildMenuAndToolbarCommand("toggle-region-tool", "Select Region", "toggle-region-tool"),
    buildMenuAndToolbarCommand("toggle-subset-bands", "Subset Bands", "toggle-subset-bands"),
    // CT-302: mask layers annotate the active panel; the toggle opens the Masks
    // options aside, the same mode-toggle shape as Select Region.
    buildMenuAndToolbarCommand("toggle-masks", "Masks", "toggle-masks"),
  ],
};

const EDIT_REGION_GROUP: OperationGroup = {
  key: "edit-region",
  commands: [
    buildMenuAndToolbarCommand("crop-to-region", "Crop to Region", "open-action-panel"),
  ],
};

const ADJUST_GROUP: OperationGroup = {
  key: "adjust",
  commands: [
    buildMenuAndToolbarCommand("tone-curve", "Contrast Curve", "open-action-panel"),
    buildMenuAndToolbarCommand("brightness-contrast", "Brightness & Contrast", "open-action-panel"),
    buildMenuOnlyActionCommand("invert", "Invert"),
  ],
};

const CLIP_GROUP: OperationGroup = {
  key: "clip",
  commands: [
    buildMenuOnlyActionCommand("threshold", "Threshold"),
    buildMenuOnlyActionCommand("percentile-clip", "Percentile Clip"),
    // CT-281: the former Normalize clip-absolute method as its own operation.
    buildMenuOnlyActionCommand("clip-by-value", "Clip by Value"),
  ],
};

// CT-289: RGB to Grayscale is a preparation tool; RGB Color Composite is a
// cross-band operation, so the two live in different menus now.
const STACK_PREPARATION_GROUP: OperationGroup = {
  key: "stack-preparation",
  commands: [
    buildMenuOnlyActionCommand("bit-shift", "Bit Shift"),
    buildMenuOnlyActionCommand("rgb-to-grayscale", "RGB to Grayscale"),
  ],
};

// CT-292: user-facing "False-color Composite" is renamed "RGB Color
// Composite"; the internal id stays "false-color".
const COMPOSITE_GROUP: OperationGroup = {
  key: "composite",
  commands: [buildMenuOnlyActionCommand("false-color", "RGB Color Composite")],
};

const TRANSFORM_GROUP: OperationGroup = {
  key: "transform",
  commands: [
    // Rotate and Flip are separate operations: each opens its own panel (Rotate
    // also offers the rotate-180 that has no one-click button). The toolbar carries
    // only the narrow direct-apply variants to avoid redundant duplicate buttons.
    // CT-279: user-facing "Reflect" is renamed "Flip"; internal ids stay "reflect".
    buildMenuOnlyActionCommand("rotate", "Rotate"),
    buildMenuOnlyActionCommand("reflect", "Flip"),
    buildToolbarOnlyTransformCommand("rotate-90-cw", "Rotate 90° clockwise"),
    buildToolbarOnlyTransformCommand("rotate-270-cw", "Rotate 90° counterclockwise"),
    buildToolbarOnlyTransformCommand("flip-horizontal", "Flip horizontally"),
    buildToolbarOnlyTransformCommand("flip-vertical", "Flip vertically"),
  ],
};

const CALIBRATE_GROUP: OperationGroup = {
  key: "calibrate",
  commands: [
    buildMenuOnlyActionCommand("flat-field", "Flat-field Correction"),
    buildMenuOnlyActionCommand("spectralon", "Spectralon Calibration"),
  ],
};

// CT-346: analysis tools moved to Tools menu (NPC and CNR).
const ANALYSIS_TOOLS_GROUP: OperationGroup = {
  key: "analysis-tools",
  commands: [
    {
      id: "npc",
      label: "NPC",
      behavior: "open-npc-panel",
      showInMenu: true,
      showInToolbar: false,
    },
    {
      id: "cnr",
      label: "CNR",
      behavior: "open-cnr-panel",
      showInMenu: true,
      showInToolbar: false,
    },
  ],
};

const DATA_GROUP: OperationGroup = {
  key: "data",
  commands: [
    buildMenuOnlyActionCommand("normalize-data", "Normalize"),
    buildMenuOnlyActionCommand("standardize", "Standardize"),
  ],
};

// Neighborhood filters (CT-200..CT-205 landed here).
// CT-280: user-facing "Spatial Filter" is renamed "Frequency Filters"; the
// internal id stays "spatial-filter".
const FILTERS_GROUP: OperationGroup = {
  key: "filters",
  commands: [
    buildMenuOnlyActionCommand("spatial-filter", "Frequency Filters"),
    buildMenuOnlyActionCommand("denoise", "Denoise"),
  ],
};

const SPECTRAL_DERIVATIVE_GROUP: OperationGroup = {
  key: "spectral-derivative",
  commands: [buildMenuOnlyActionCommand("spectral-derivative", "Spectral Derivative")],
};

const DIMENSION_REDUCTION_GROUP: OperationGroup = {
  key: "dimension-reduction",
  commands: [
    buildMenuOnlyActionCommand("pca", "PCA"),
    buildMenuOnlyActionCommand("mnf", "MNF"),
    buildMenuOnlyActionCommand("ica", "ICA"),
    // CT-311/CT-312: spatially adaptive PCA/MNF, running the client Python built-ins.
    buildMenuOnlyActionCommand("local-pca", "Local PCA"),
    buildMenuOnlyActionCommand("local-mnf", "Local MNF"),
    // CT-313: the client's L2 binarization approximation, driven by masks.
    buildMenuOnlyActionCommand("l2-minimization", "L2 Minimization"),
  ],
};

// Stage 5 band-combining operations gated behind the scripting worker
// (CT-209, CT-210). CT-284: Band Selection has no menu entry anymore; its
// derive-a-band-by-function capabilities live in the Subset Bands editor's
// "By function" mode (the band-selection action stays registered so the merged
// editor applies through it and old History labels keep their vocabulary).
// CT-289: user-facing "Band Weighting" is renamed "Weighted Sum"; the internal
// id stays "band-weighting".
const BAND_OPS_GROUP: OperationGroup = {
  key: "band-ops",
  commands: [
    buildMenuOnlyActionCommand("band-weighting", "Weighted Sum"),
    // CT-300: concatenate two open stacks' bands into one wider stack.
    buildMenuOnlyActionCommand("concatenate-stacks", "Concatenate Stacks"),
  ],
};

// CT-309: random orthogonal projections with press-to-reroll previews. Opens
// its own panel instead of the shared tool-options panel (CT-308). ROP stays in
// Multi-band while NPC and CNR moved to Tools (CT-346).
const ROP_GROUP: OperationGroup = {
  key: "rop",
  commands: [
    {
      id: "rop",
      label: "ROP",
      behavior: "open-rop-panel",
      showInMenu: true,
      showInToolbar: false,
    },
  ],
};

// Whole-cube user scripting (CT-216).
const SCRIPTS_GROUP: OperationGroup = {
  key: "scripts",
  commands: [buildMenuOnlyActionCommand("custom-transform", "Custom Transform")],
};

// Selecting, reshaping, and preparing a stack: what the image IS, not its
// values. Group order matters for the toolbar projection (selection,
// edit-region, transform carry the toolbar buttons, in this sequence).
export const TOOLS_MENU: OperationMenu = {
  menuLabel: "Tools",
  groups: [
    SELECTION_GROUP,
    EDIT_REGION_GROUP,
    TRANSFORM_GROUP,
    STACK_PREPARATION_GROUP,
    CALIBRATE_GROUP,
    ANALYSIS_TOOLS_GROUP,
  ],
};

// Per-pixel and per-band value processing on the current stack.
export const BASIC_PROCESSING_MENU: OperationMenu = {
  menuLabel: "Basic Processing",
  groups: [ADJUST_GROUP, CLIP_GROUP, DATA_GROUP, FILTERS_GROUP, SCRIPTS_GROUP],
};

// Operations across the band dimension or the whole cube.
export const MULTI_BAND_MENU: OperationMenu = {
  menuLabel: "Multi-band",
  groups: [
    COMPOSITE_GROUP,
    SPECTRAL_DERIVATIVE_GROUP,
    DIMENSION_REDUCTION_GROUP,
    BAND_OPS_GROUP,
    ROP_GROUP,
  ],
};

export const OPERATION_MENUS: ReadonlyArray<OperationMenu> = [
  TOOLS_MENU,
  BASIC_PROCESSING_MENU,
  MULTI_BAND_MENU,
];

export function listAllOperationCommands(): ReadonlyArray<OperationCommand> {
  return OPERATION_MENUS.flatMap((menu) => menu.groups).flatMap((group) => group.commands);
}

// The presentation order of a native operation menu: every showInMenu command
// across the menu's groups, alphabetically by label, with no separators.
export function listMenuCommandsAlphabetically(
  menu: OperationMenu,
): ReadonlyArray<OperationCommand> {
  return menu.groups
    .flatMap((group) => group.commands)
    .filter((command) => command.showInMenu)
    .sort((first, second) => first.label.localeCompare(second.label));
}

export function findOperationCommandById(commandId: string): OperationCommand | null {
  return listAllOperationCommands().find((command) => command.id === commandId) ?? null;
}
