import type { ElectronApplication } from "@playwright/test";

import { CUSTOM_SCRIPT_MENU_LABEL } from "../../src/shared/custom-script-menu";
import { OPERATION_MENUS } from "../../src/shared/operation-menu-catalog";

const OPERATION_MENU_LABELS = OPERATION_MENUS.map((menu) => menu.menuLabel);

export interface MenuItemSummary {
  label: string;
  role: string | undefined;
  submenu: MenuItemSummary[];
}

export interface WindowOuterBounds {
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface AppNameAndVersion {
  name: string;
  version: string;
}

export function describeApplicationMenu(
  app: ElectronApplication,
): Promise<MenuItemSummary[]> {
  return app.evaluate(({ Menu }) => {
    interface RawMenuNode {
      label: string;
      role?: string;
      submenu?: { items: RawMenuNode[] };
    }
    const summarize = (item: RawMenuNode): MenuItemSummary => ({
      label: item.label,
      role: item.role,
      submenu: (item.submenu?.items ?? []).map(summarize),
    });
    const menu = Menu.getApplicationMenu() as unknown as {
      items: RawMenuNode[];
    } | null;
    return (menu?.items ?? []).map(summarize);
  });
}

export function triggerAboutMenuItem(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ Menu }) => {
    interface RawMenuNode {
      label: string;
      role?: string;
      click?: () => void;
      submenu?: { items: RawMenuNode[] };
    }
    const menu = Menu.getApplicationMenu() as unknown as {
      items: RawMenuNode[];
    } | null;
    const help = (menu?.items ?? []).find(
      (item) => item.role === "help" || item.label === "Help",
    );
    const about = help?.submenu?.items.find((item) =>
      item.label.startsWith("About"),
    );
    about?.click?.();
  });
}

export function triggerSaveImageMenuItem(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ Menu }) => {
    interface RawMenuNode {
      label: string;
      role?: string;
      click?: () => void;
      submenu?: { items: RawMenuNode[] };
    }
    const menu = Menu.getApplicationMenu() as unknown as {
      items: RawMenuNode[];
    } | null;
    const file = (menu?.items ?? []).find((item) => item.label === "File");
    const save = file?.submenu?.items.find((item) =>
      item.label.startsWith("Save Image"),
    );
    save?.click?.();
  });
}

function clickFileMenuItemWhoseLabelStartsWith(
  app: ElectronApplication,
  labelPrefix: string,
): Promise<void> {
  return app.evaluate(({ Menu }, prefix) => {
    interface RawMenuNode {
      label: string;
      click?: () => void;
      submenu?: { items: RawMenuNode[] };
    }
    const menu = Menu.getApplicationMenu() as unknown as { items: RawMenuNode[] } | null;
    const file = (menu?.items ?? []).find((item) => item.label === "File");
    const target = file?.submenu?.items.find((item) => item.label.startsWith(prefix));
    target?.click?.();
  }, labelPrefix);
}

// Clicks an operation item in whichever operation menu (Tools,
// Basic Processing, Multi-band) carries it, and fails loudly when the label is
// missing so a regrouped menu cannot silently no-op a spec.
export function triggerOperationMenuItem(
  app: ElectronApplication,
  operationLabel: string,
): Promise<void> {
  return app.evaluate(({ Menu }, { label, menuLabels }) => {
    interface RawMenuNode {
      label: string;
      click?: () => void;
      submenu?: { items: RawMenuNode[] };
    }
    const menu = Menu.getApplicationMenu() as unknown as { items: RawMenuNode[] } | null;
    const operationMenus = (menu?.items ?? []).filter((item) => menuLabels.includes(item.label));
    const target = operationMenus
      .flatMap((topLevel) => topLevel.submenu?.items ?? [])
      .find((item) => item.label === label);
    if (!target?.click) throw new Error(`No menu item "${label}" in: ${menuLabels.join(", ")}`);
    target.click();
  }, { label: operationLabel, menuLabels: OPERATION_MENU_LABELS });
}

// CT-289: clicks View > Grid > <layout> ("1x2", ...), the native mirror of the
// toolbar's grid-layout dropdown (CT-352 moved the submenu from File to View).
export function triggerViewGridLayoutMenuItem(
  app: ElectronApplication,
  layout: string,
): Promise<void> {
  return app.evaluate(({ Menu }, targetLayout) => {
    interface RawMenuNode {
      label: string;
      click?: () => void;
      submenu?: { items: RawMenuNode[] };
    }
    const menu = Menu.getApplicationMenu() as unknown as { items: RawMenuNode[] } | null;
    const view = (menu?.items ?? []).find((item) => item.label === "View");
    const grid = view?.submenu?.items.find((item) => item.label === "Grid");
    const target = grid?.submenu?.items.find((item) => item.label === targetLayout);
    if (!target?.click) throw new Error(`No View > Grid > "${targetLayout}" menu item`);
    target.click();
  }, layout);
}

// CT-352: clicks an item of the hand-built top-level Custom Script menu by its
// exact label ("Enter Inline Formula", "Import Script...", ...).
export function triggerCustomScriptMenuItem(
  app: ElectronApplication,
  itemLabel: string,
): Promise<void> {
  return app.evaluate(({ Menu }, { label, menuLabel }) => {
    interface RawMenuNode {
      label: string;
      click?: () => void;
      submenu?: { items: RawMenuNode[] };
    }
    const menu = Menu.getApplicationMenu() as unknown as { items: RawMenuNode[] } | null;
    const customScript = (menu?.items ?? []).find((item) => item.label === menuLabel);
    const target = customScript?.submenu?.items.find((item) => item.label === label);
    if (!target?.click) throw new Error(`No ${menuLabel} > "${label}" menu item`);
    target.click();
  }, { label: itemLabel, menuLabel: CUSTOM_SCRIPT_MENU_LABEL });
}

export function triggerSaveProjectMenuItem(app: ElectronApplication): Promise<void> {
  return clickFileMenuItemWhoseLabelStartsWith(app, "Save Project");
}

export function triggerOpenProjectMenuItem(app: ElectronApplication): Promise<void> {
  return clickFileMenuItemWhoseLabelStartsWith(app, "Open Project");
}

// CT-258: drives the real window close (the path the save-on-close guard
// intercepts), exactly as the user clicking the window's close button would.
export function triggerMainWindowClose(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => {
    const isMainUrl = (url: string): boolean =>
      url !== "" &&
      url !== "about:blank" &&
      !url.startsWith("devtools://") &&
      !url.includes("splash");
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      isMainUrl(candidate.webContents.getURL()),
    );
    if (!window) throw new Error("No main window found in the main process");
    window.close();
  });
}

export function readAppNameAndVersion(
  app: ElectronApplication,
): Promise<AppNameAndVersion> {
  return app.evaluate(({ app: electronApp }) => ({
    name: electronApp.getName(),
    version: electronApp.getVersion(),
  }));
}

export function readMainWindowOuterBounds(
  app: ElectronApplication,
): Promise<WindowOuterBounds> {
  return app.evaluate(({ BrowserWindow }) => {
    const isMainUrl = (url: string): boolean =>
      url !== "" &&
      url !== "about:blank" &&
      !url.startsWith("devtools://") &&
      !url.includes("splash");
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      isMainUrl(candidate.webContents.getURL()),
    );
    if (!window) throw new Error("No main window found in the main process");
    const bounds = window.getBounds();
    return { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
  });
}

export function resizeAndMoveMainWindow(
  app: ElectronApplication,
  target: WindowOuterBounds,
): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow }, requestedBounds) => {
      const isMainUrl = (url: string): boolean =>
        url !== "" &&
        url !== "about:blank" &&
        !url.startsWith("devtools://") &&
        !url.includes("splash");
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        isMainUrl(candidate.webContents.getURL()),
      );
      if (!window) throw new Error("No main window found in the main process");
      window.unmaximize();
      window.setBounds(requestedBounds);
    },
    target,
  );
}

export function readUserDataDirectory(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
}
