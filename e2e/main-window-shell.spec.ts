import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  closeToolboxApp,
  countMainApplicationWindows,
  launchToolboxApp,
  type LaunchedApp,
} from "./support/launch-app";
import {
  listMenuCommandsAlphabetically,
  OPERATION_MENUS,
} from "../src/shared/operation-menu-catalog";
import { SELECTABLE_GRID_LAYOUTS } from "../src/shared/grid-layouts";
import {
  CUSTOM_SCRIPT_MENU_ITEM_LABELS,
  CUSTOM_SCRIPT_MENU_LABEL,
  ENTER_INLINE_FORMULA_MENU_ITEM_LABEL,
} from "../src/shared/custom-script-menu";
import {
  describeApplicationMenu,
  readAppNameAndVersion,
  readMainWindowOuterBounds,
  readUserDataDirectory,
  resizeAndMoveMainWindow,
  triggerAboutMenuItem,
  triggerCustomScriptMenuItem,
  triggerViewGridLayoutMenuItem,
  type MenuItemSummary,
  type WindowOuterBounds,
} from "./support/main-process";
import { gridLayoutDropdownTrigger } from "./support/grid-layout-controls";
import { cancelOperation, operationPanel } from "./support/operations";
import { loadFixtureAsStack } from "./support/load-fixture";
import { multiBandTiff } from "./fixtures/fixture-manifest";

// Manual test script section 3 (CT-003): main window shell, menus, About dialog.

const requireFromHere = createRequire(import.meta.url);
const packageJson = requireFromHere("../package.json") as { version: string };

interface WindowStateBackup {
  path: string;
  existed: boolean;
  content: string;
}

let launched: LaunchedApp;
let windowStateBackup: WindowStateBackup;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
  const userDataDirectory = await readUserDataDirectory(launched.app);
  windowStateBackup = captureWindowStateBackup(
    join(userDataDirectory, "window-state.json"),
  );
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
  restoreWindowStateBackup(windowStateBackup);
});

test("opens exactly one main application window", () => {
  expect(countMainApplicationWindows(launched.app)).toBe(1);
});

test("window title is CHARM Toolbox", async () => {
  expect(await launched.window.title()).toBe("CHARM Toolbox");
});

test("main window opens at a sensible size", async () => {
  const bounds = await readMainWindowOuterBounds(launched.app);
  expect(bounds.width).toBeGreaterThanOrEqual(1024);
  expect(bounds.height).toBeGreaterThanOrEqual(700);
});

test("File menu exposes Open Images and the app can be quit", async () => {
  const menu = await describeApplicationMenu(launched.app);
  const fileMenu = findTopLevelMenu(menu, "File");
  expect(submenuLabelsOf(fileMenu)).toContain("Open Images...");
  expect(menuTreeHasQuitItem(menu)).toBe(true);
});

// CT-289: a Grid submenu mirrors the toolbar's layouts. CT-352: it lives
// under View (first item), not under File.
test("View menu carries the Grid submenu of the selectable layouts, and File does not", async () => {
  const menu = await describeApplicationMenu(launched.app);
  const viewMenu = findTopLevelMenu(menu, "View");
  expect(submenuLabelsOf(viewMenu)[0]).toBe("Grid");
  const gridSubmenu = viewMenu?.submenu.find((item) => item.label === "Grid");
  expect(submenuLabelsOf(gridSubmenu)).toEqual([...SELECTABLE_GRID_LAYOUTS]);
  expect(submenuLabelsOf(findTopLevelMenu(menu, "File"))).not.toContain("Grid");
});

test("View > Grid selects a layout exactly like the toolbar dropdown", async () => {
  await triggerViewGridLayoutMenuItem(launched.app, "1x2");
  await expect(gridLayoutDropdownTrigger(launched.window)).toHaveAccessibleName(
    "Grid layout (currently 1x2)",
  );
  await triggerViewGridLayoutMenuItem(launched.app, "1x1");
  await expect(gridLayoutDropdownTrigger(launched.window)).toHaveAccessibleName(
    "Grid layout (currently 1x1)",
  );
});

// CT-352: the client's "Full Screen on/off" wording replaces Electron's
// default "Toggle Full Screen"; the role (and its accelerator) stays.
test("View menu labels the full-screen toggle Full Screen on/off", async () => {
  const menu = await describeApplicationMenu(launched.app);
  const viewMenu = findTopLevelMenu(menu, "View");
  const fullScreen = viewMenu?.submenu.find((item) => item.role === "togglefullscreen");
  expect(fullScreen?.label).toBe("Full Screen on/off");
  expect(submenuLabelsOf(viewMenu)).not.toContain("Python Environment...");
});

// CT-352: one top-level Custom Script menu gathers the interpreter choice
// (from View), the scripting guide (from Help) and the two panel entry points
// (formerly Basic Processing > Custom Transform), in the client's order.
test("a Custom Script menu sits between the operation menus and View with the four scripting items", async () => {
  const menu = await describeApplicationMenu(launched.app);
  const topLevelLabels = menu.map((item) => item.label);
  const customScriptIndex = topLevelLabels.indexOf(CUSTOM_SCRIPT_MENU_LABEL);
  expect(customScriptIndex).toBe(topLevelLabels.indexOf("Multi-band") + 1);
  expect(topLevelLabels[customScriptIndex + 1]).toBe("View");
  const customScriptMenu = findTopLevelMenu(menu, CUSTOM_SCRIPT_MENU_LABEL);
  expect(nonSeparatorLabelsOf(customScriptMenu)).toEqual([...CUSTOM_SCRIPT_MENU_ITEM_LABELS]);
  expect(submenuLabelsOf(findHelpMenu(menu))).not.toContain("How to Write a Custom Script");
});

// The formula editor embeds only for a selected stack, so a fixture is loaded
// first; the panel opening from the menu item is the behaviour under test.
test("Custom Script > Enter Inline Formula opens the Custom Script panel", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await triggerCustomScriptMenuItem(launched.app, ENTER_INLINE_FORMULA_MENU_ITEM_LABEL);
  const panel = operationPanel(launched.window, CUSTOM_SCRIPT_MENU_LABEL);
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Transform formula", { exact: true })).toBeVisible();
  await cancelOperation(launched.window, CUSTOM_SCRIPT_MENU_LABEL);
  await expect(panel).toBeHidden();
});

test("every operation menu mirrors the shared catalog, alphabetically and without separators", async () => {
  const menu = await describeApplicationMenu(launched.app);
  for (const operationMenu of OPERATION_MENUS) {
    const topLevel = findTopLevelMenu(menu, operationMenu.menuLabel);
    expect(topLevel, `missing top-level menu "${operationMenu.menuLabel}"`).toBeDefined();
    expect(submenuLabelsOf(topLevel)).toEqual(nonSeparatorLabelsOf(topLevel));
    expect(nonSeparatorLabelsOf(topLevel)).toEqual(menuItemLabelsFromCatalog(operationMenu));
  }
});

test("View menu is present", async () => {
  const menu = await describeApplicationMenu(launched.app);
  expect(findTopLevelMenu(menu, "View")).toBeDefined();
});

test("Help menu exposes About", async () => {
  const menu = await describeApplicationMenu(launched.app);
  const helpMenu = findHelpMenu(menu);
  expect(submenuLabelsOf(helpMenu).some(isAboutLabel)).toBe(true);
});

test("Help > About opens a shadcn dialog showing the app name and version", async () => {
  await triggerAboutMenuItem(launched.app);
  const dialog = launched.window.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const appInfo = await readAppNameAndVersion(launched.app);
  expect(appInfo.version).toBe(packageJson.version);
  await expect(dialog.getByText(`About ${appInfo.name}`)).toBeVisible();
  await expect(dialog.getByText(`Version ${appInfo.version}`)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await closeAboutDialog(dialog);
});

test("window size persists across close and reopen", async () => {
  await assertWindowSizeRoundTripsAcrossRelaunch({
    width: 1100,
    height: 720,
    x: 120,
    y: 90,
  });
});

async function closeAboutDialog(
  dialog: ReturnType<LaunchedApp["window"]["getByRole"]>,
): Promise<void> {
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

async function assertWindowSizeRoundTripsAcrossRelaunch(
  target: WindowOuterBounds,
): Promise<void> {
  const first = await launchToolboxApp();
  await resizeAndMoveMainWindow(first.app, target);
  await closeToolboxApp(first);
  const second = await launchToolboxApp();
  const restored = await readMainWindowOuterBounds(second.app);
  await closeToolboxApp(second);
  expect(restored.width).toBe(target.width);
  expect(restored.height).toBe(target.height);
}

function findTopLevelMenu(
  menu: MenuItemSummary[],
  label: string,
): MenuItemSummary | undefined {
  return menu.find((item) => item.label === label);
}

function findHelpMenu(menu: MenuItemSummary[]): MenuItemSummary | undefined {
  return menu.find((item) => item.role === "help" || item.label === "Help");
}

function submenuLabelsOf(menu: MenuItemSummary | undefined): string[] {
  return (menu?.submenu ?? []).map((item) => item.label);
}

function nonSeparatorLabelsOf(menu: MenuItemSummary | undefined): string[] {
  return submenuLabelsOf(menu).filter((label) => typeof label === "string" && label.length > 0);
}

function menuItemLabelsFromCatalog(
  operationMenu: (typeof OPERATION_MENUS)[number],
): string[] {
  return listMenuCommandsAlphabetically(operationMenu).map((command) => command.label);
}

function isAboutLabel(label: string): boolean {
  return label.startsWith("About");
}

function menuTreeHasQuitItem(menu: MenuItemSummary[]): boolean {
  return menu.some(menuNodeContainsQuit);
}

function menuNodeContainsQuit(item: MenuItemSummary): boolean {
  if (item.role === "quit") return true;
  return item.submenu.some(menuNodeContainsQuit);
}

function captureWindowStateBackup(path: string): WindowStateBackup {
  const existed = existsSync(path);
  return { path, existed, content: existed ? readFileSync(path, "utf-8") : "" };
}

function restoreWindowStateBackup(backup: WindowStateBackup): void {
  if (backup.existed) {
    writeFileSync(backup.path, backup.content);
    return;
  }
  if (existsSync(backup.path)) rmSync(backup.path);
}
