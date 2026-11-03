import {
  app,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { SCRIPTING_DOCS_URL } from "../shared/scripting-docs-url";
import {
  applyThemeModeFromMenu,
  getCurrentThemeMode,
} from "./theme-controller";
import type { ThemeMode } from "./theme-state";
import {
  CUSTOM_SCRIPT_FORMULA_COMMAND_ID,
  CUSTOM_SCRIPT_IMPORT_COMMAND_ID,
  listMenuCommandsAlphabetically,
  OPERATION_MENUS,
  type OperationCommand,
  type OperationMenu,
} from "../shared/operation-menu-catalog";
import { SELECTABLE_GRID_LAYOUTS, type GridLayout } from "../shared/grid-layouts";
import {
  CUSTOM_SCRIPT_MENU_LABEL,
  ENTER_INLINE_FORMULA_MENU_ITEM_LABEL,
  HOW_TO_WRITE_SCRIPT_MENU_ITEM_LABEL,
  IMPORT_SCRIPT_MENU_ITEM_LABEL,
  PYTHON_ENVIRONMENT_MENU_ITEM_LABEL,
} from "../shared/custom-script-menu";

const isRunningOnMac = process.platform === "darwin";
const isRunningInDevMode = process.env.NODE_ENV === "development";
const MENU_INVOKE_COMMAND_CHANNEL = "menu:invoke-command";
const MENU_SELECT_GRID_LAYOUT_CHANNEL = "menu:select-grid-layout";

function buildMacAppMenu(): MenuItemConstructorOptions {
  return {
    label: app.getName(),
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
}

function sendMenuChannelToRenderer(
  window: BrowserWindow,
  channel: string,
): void {
  if (window.isDestroyed()) return;
  window.webContents.send(channel);
}

function buildOpenImagesMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Open Images...",
    accelerator: "CmdOrCtrl+O",
    click: () => sendMenuChannelToRenderer(window, "menu:open-image"),
  };
}

function buildSaveImageMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Save Image...",
    accelerator: "CmdOrCtrl+S",
    click: () => sendMenuChannelToRenderer(window, "menu:save-image"),
  };
}

function buildOpenProjectMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Open Project...",
    accelerator: "CmdOrCtrl+Shift+O",
    click: () => sendMenuChannelToRenderer(window, "menu:open-project"),
  };
}

function buildSaveProjectMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Save Project",
    accelerator: "CmdOrCtrl+Shift+S",
    click: () => sendMenuChannelToRenderer(window, "menu:save-project"),
  };
}

function buildSaveProjectAsMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Save Project As...",
    click: () => sendMenuChannelToRenderer(window, "menu:save-project-as"),
  };
}

function sendGridLayoutSelectionToRenderer(
  window: BrowserWindow,
  layout: GridLayout,
): void {
  if (window.isDestroyed()) return;
  window.webContents.send(MENU_SELECT_GRID_LAYOUT_CHANNEL, layout);
}

// CT-289: the grid layouts submenu mirrors the toolbar's layout dropdown.
// CT-352: it lives under View (it was under File after the project items).
function buildGridLayoutsSubmenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: "Grid",
    submenu: SELECTABLE_GRID_LAYOUTS.map((layout) => ({
      label: layout,
      click: () => sendGridLayoutSelectionToRenderer(window, layout),
    })),
  };
}

function buildFileMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [
      buildOpenImagesMenuItem(window),
      buildSaveImageMenuItem(window),
      { type: "separator" },
      buildOpenProjectMenuItem(window),
      buildSaveProjectMenuItem(window),
      buildSaveProjectAsMenuItem(window),
      { type: "separator" },
      isRunningOnMac ? { role: "close" } : { role: "quit" },
    ],
  };
}

function sendMenuCommandToRenderer(
  window: BrowserWindow,
  commandId: string,
): void {
  if (window.isDestroyed()) return;
  window.webContents.send(MENU_INVOKE_COMMAND_CHANNEL, commandId);
}

function buildOperationCommandMenuItem(
  window: BrowserWindow,
  command: OperationCommand,
): MenuItemConstructorOptions {
  return {
    label: command.label,
    click: () => sendMenuCommandToRenderer(window, command.id),
  };
}

// Operation menus are flat alphabetical lists with no separators: find an
// operation by name. (File keeps its separators; its groups are workflows,
// not an operation inventory.)
function buildOperationMenu(
  window: BrowserWindow,
  menu: OperationMenu,
): MenuItemConstructorOptions {
  const items = listMenuCommandsAlphabetically(menu).map((command) =>
    buildOperationCommandMenuItem(window, command),
  );
  return { label: menu.menuLabel, submenu: items };
}

function buildOperationMenus(window: BrowserWindow): MenuItemConstructorOptions[] {
  return OPERATION_MENUS.map((menu) => buildOperationMenu(window, menu));
}

function buildThemeRadioItem(
  label: string,
  mode: ThemeMode,
  currentMode: ThemeMode,
): MenuItemConstructorOptions {
  return {
    label,
    type: "radio",
    checked: currentMode === mode,
    click: () => applyThemeModeFromMenu(mode),
  };
}

function buildThemeSubmenu(): MenuItemConstructorOptions {
  const currentMode = getCurrentThemeMode();
  return {
    label: "Theme",
    submenu: [
      buildThemeRadioItem("System", "system", currentMode),
      buildThemeRadioItem("Light", "light", currentMode),
      buildThemeRadioItem("Dark", "dark", currentMode),
    ],
  };
}

function buildDeveloperRefreshMenuItems(): MenuItemConstructorOptions[] {
  if (!isRunningInDevMode) return [];
  return [
    { type: "separator" },
    { role: "reload" },
    { role: "toggleDevTools" },
  ];
}

function buildPythonEnvironmentMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: PYTHON_ENVIRONMENT_MENU_ITEM_LABEL,
    click: () => sendMenuChannelToRenderer(window, "menu:python-environment"),
  };
}

// CT-352: the client asked for "Full Screen on/off" over Electron's default
// "Toggle Full Screen"; the role keeps the platform accelerator and behaviour.
const FULL_SCREEN_MENU_ITEM_LABEL = "Full Screen on/off";

function buildViewMenuSubmenu(
  window: BrowserWindow,
): MenuItemConstructorOptions[] {
  return [
    buildGridLayoutsSubmenu(window),
    { type: "separator" },
    buildThemeSubmenu(),
    ...buildDeveloperRefreshMenuItems(),
    { type: "separator" },
    { role: "togglefullscreen", label: FULL_SCREEN_MENU_ITEM_LABEL },
  ];
}

function buildViewMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: "View",
    submenu: buildViewMenuSubmenu(window),
  };
}

function buildAboutMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: `About ${app.getName()}`,
    click: () => sendMenuChannelToRenderer(window, "menu:about"),
  };
}

function buildHowToWriteScriptMenuItem(): MenuItemConstructorOptions {
  return {
    label: HOW_TO_WRITE_SCRIPT_MENU_ITEM_LABEL,
    click: () => void shell.openExternal(SCRIPTING_DOCS_URL),
  };
}

// CT-352: a top-level Custom Script menu gathers everything about user
// scripting, in the order the client listed: the interpreter choice (from
// View), the scripting guide (from Help), and the two ways into the Custom
// Script panel (formerly Basic Processing > Custom Transform). The two panel
// items dispatch catalog commands by id like any operation menu item.
function buildEnterInlineFormulaMenuItem(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: ENTER_INLINE_FORMULA_MENU_ITEM_LABEL,
    click: () => sendMenuCommandToRenderer(window, CUSTOM_SCRIPT_FORMULA_COMMAND_ID),
  };
}

function buildImportScriptMenuItem(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: IMPORT_SCRIPT_MENU_ITEM_LABEL,
    click: () => sendMenuCommandToRenderer(window, CUSTOM_SCRIPT_IMPORT_COMMAND_ID),
  };
}

function buildCustomScriptMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: CUSTOM_SCRIPT_MENU_LABEL,
    submenu: [
      buildPythonEnvironmentMenuItem(window),
      buildHowToWriteScriptMenuItem(),
      { type: "separator" },
      buildEnterInlineFormulaMenuItem(window),
      buildImportScriptMenuItem(window),
    ],
  };
}

function buildHelpMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [buildAboutMenuItem(window)],
  };
}

function buildMenuTemplateForPlatform(
  window: BrowserWindow,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (isRunningOnMac) template.push(buildMacAppMenu());
  template.push(buildFileMenu(window));
  template.push(...buildOperationMenus(window));
  template.push(buildCustomScriptMenu(window));
  template.push(buildViewMenu(window));
  template.push(buildHelpMenu(window));
  return template;
}

export function installApplicationMenu(window: BrowserWindow): void {
  const template = buildMenuTemplateForPlatform(window);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
