import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installApplicationMenu } from "./menu";
import {
  attachWindowStatePersistence,
  loadSavedWindowBounds,
  type WindowBounds,
} from "./window-state";
import { registerAppInfoIpcHandler } from "./app-info";
import { chooseAppUserModelIdForTaskbarGrouping } from "./app-user-model-id";
import {
  E2E_TEST_MODE_PRELOAD_ARGUMENT,
  isE2eTestModeEnabled,
  registerE2eDialogStubTestChannelsWhenEnabled,
} from "./e2e-dialog-stub";
import { registerE2ePythonObservabilityChannelsWhenEnabled } from "./e2e-python-observability";
import {
  buildMemoryBudgetPreloadArgumentOrNull,
  E2E_MEMORY_BUDGET_ENVIRONMENT_VARIABLE,
} from "../shared/e2e-memory-budget-argument";
import {
  buildRopSeedPreloadArgumentOrNull,
  E2E_ROP_SEED_ENVIRONMENT_VARIABLE,
} from "../shared/e2e-rop-seed-argument";
import { registerMaskImportDialogIpcHandler } from "./mask-import-dialog";
import { registerOpenBundleDialogIpcHandlers } from "./open-bundle-dialog";
import { registerOpenImageDialogIpcHandler } from "./open-image-dialog";
import { registerChunkedOpenedImageReadIpcHandlers } from "./chunked-opened-image-read-ipc";
import { registerChunkedPng16DecodeIpcHandlers } from "./chunked-png16-decode-ipc";
import { registerOpenImagesDialogIpcHandlers } from "./open-images-dialog";
import { registerSaveBundleDialogIpcHandlers } from "./save-bundle-dialog";
import { registerSaveImageDialogIpcHandlers } from "./save-image-dialog";
import { initializeThemeControllerFromDisk } from "./theme-controller";
import { initializePythonEnvironmentControllerFromDisk } from "./python/python-environment-controller";
import { registerRunUserScriptIpcHandler } from "./python/user-script-ipc";
import { registerRendererCrashLogging } from "./renderer-crash-logging";
import { createSplashWindow, type SplashWindowHandle } from "./splash-window";
import {
  interceptWindowCloseUntilRendererConfirms,
  registerConfirmCloseIpcHandler,
} from "./window-close-guard";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CT-239 test surface (MSI_E2E only, like the dialog stubs): expose window.gc
// in every renderer so the scale10 sweep can deterministically release closed
// panels' cubes between full-scale applies. The renderer's ArrayBuffer pool is
// a hard ~17 GB cap and V8 does not run a last-resort collection when a
// backing-store allocation fails, so tests cannot rely on collection timing.
// No effect on production launches.
function exposeGarbageCollectionForE2eTestMode(): void {
  if (!isE2eTestModeEnabled()) return;
  app.commandLine.appendSwitch("js-flags", "--expose-gc");
}

exposeGarbageCollectionForE2eTestMode();

function buildPreloadScriptPath(): string {
  return join(__dirname, "../preload/index.js");
}

function buildRendererIndexHtmlPath(): string {
  return join(__dirname, "../renderer/index.html");
}

function isRunningInDevelopment(): boolean {
  return Boolean(process.env["ELECTRON_RENDERER_URL"]);
}

function resolveDevelopmentModeWindowIconPath(): string | undefined {
  if (!isRunningInDevelopment()) return undefined;
  return join(__dirname, "../../build/icon.ico");
}

function setWindowsAppUserModelIdForTaskbarGrouping(): void {
  if (process.platform !== "win32") return;
  app.setAppUserModelId(
    chooseAppUserModelIdForTaskbarGrouping(isRunningInDevelopment()),
  );
}

function loadRendererIntoWindow(window: BrowserWindow): void {
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
    return;
  }
  void window.loadFile(buildRendererIndexHtmlPath());
}

function attachExternalLinkHandler(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

function buildBrowserWindowOptionsFrom(
  bounds: WindowBounds,
): Electron.BrowserWindowConstructorOptions {
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    icon: resolveDevelopmentModeWindowIconPath(),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: buildPreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: buildPreloadAdditionalArguments(),
    },
  };
}

function buildPreloadAdditionalArguments(): string[] {
  if (!isE2eTestModeEnabled()) return [];
  return [
    E2E_TEST_MODE_PRELOAD_ARGUMENT,
    ...listMemoryBudgetOverrideArguments(),
    ...listRopSeedOverrideArguments(),
  ];
}

// CT-309 e2e test surface: forward a forced ROP seed into the preload so a
// "New projection" press is reproducible against the pinned reference output.
// Only ever reached under MSI_E2E, so production launches carry no override.
function listRopSeedOverrideArguments(): string[] {
  const argument = buildRopSeedPreloadArgumentOrNull(
    process.env[E2E_ROP_SEED_ENVIRONMENT_VARIABLE],
  );
  return argument === null ? [] : [argument];
}

// CT-260 e2e test surface: forward a lowered raster-memory budget into the
// preload so memory refusals are reproducible with tiny fixtures. Only ever
// reached under MSI_E2E, so production launches carry no override.
function listMemoryBudgetOverrideArguments(): string[] {
  const argument = buildMemoryBudgetPreloadArgumentOrNull(
    process.env[E2E_MEMORY_BUDGET_ENVIRONMENT_VARIABLE],
  );
  return argument === null ? [] : [argument];
}

function maximizeWindowIfPreviouslyMaximized(
  window: BrowserWindow,
  bounds: WindowBounds,
): void {
  if (bounds.isMaximized) window.maximize();
}

// The main window can be closed while the splash minimum is still running
// (CT-258 made that an ordinary flow); showing a destroyed window would throw
// and leak the splash as a ghost window that keeps the app process alive.
async function showMainWindowAfterSplashMinimumElapsed(
  mainWindow: BrowserWindow,
  splash: SplashWindowHandle | null,
): Promise<void> {
  if (splash !== null) await splash.waitUntilMinimumDisplayDurationElapsed();
  if (!mainWindow.isDestroyed()) mainWindow.show();
  if (splash !== null) splash.dismiss();
}

function dismissSplashWhenMainWindowClosesFirst(
  mainWindow: BrowserWindow,
  splash: SplashWindowHandle | null,
): void {
  if (splash === null) return;
  mainWindow.on("closed", () => splash.dismiss());
}

function deferMainWindowShowUntilReadyAndSplashElapsed(
  mainWindow: BrowserWindow,
  splash: SplashWindowHandle | null,
): void {
  mainWindow.once("ready-to-show", () => {
    void showMainWindowAfterSplashMinimumElapsed(mainWindow, splash);
  });
}

function createMainWindow(splash: SplashWindowHandle | null): BrowserWindow {
  const savedBounds = loadSavedWindowBounds();
  const window = new BrowserWindow(buildBrowserWindowOptionsFrom(savedBounds));
  maximizeWindowIfPreviouslyMaximized(window, savedBounds);
  deferMainWindowShowUntilReadyAndSplashElapsed(window, splash);
  dismissSplashWhenMainWindowClosesFirst(window, splash);
  attachExternalLinkHandler(window);
  attachWindowStatePersistence(window);
  interceptWindowCloseUntilRendererConfirms(window);
  installApplicationMenu(window);
  loadRendererIntoWindow(window);
  if (isRunningInDevelopment()) {
    window.webContents.openDevTools({ mode: "detach" });
  }
  return window;
}

function reopenWindowOnMacActivate(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(null);
  }
}

function quitWhenAllWindowsClosed(): void {
  if (process.platform !== "darwin") {
    app.quit();
  }
}

app.whenReady().then(() => {
  registerRendererCrashLogging();
  setWindowsAppUserModelIdForTaskbarGrouping();
  initializeThemeControllerFromDisk();
  initializePythonEnvironmentControllerFromDisk();
  registerRunUserScriptIpcHandler();
  registerAppInfoIpcHandler();
  registerOpenImageDialogIpcHandler();
  registerOpenImagesDialogIpcHandlers();
  registerChunkedOpenedImageReadIpcHandlers();
  registerChunkedPng16DecodeIpcHandlers();
  registerSaveImageDialogIpcHandlers();
  registerMaskImportDialogIpcHandler();
  registerOpenBundleDialogIpcHandlers();
  registerSaveBundleDialogIpcHandlers();
  registerConfirmCloseIpcHandler();
  registerE2eDialogStubTestChannelsWhenEnabled();
  registerE2ePythonObservabilityChannelsWhenEnabled();
  const splash = createSplashWindow();
  createMainWindow(splash);
  app.on("activate", reopenWindowOnMacActivate);
});

app.on("window-all-closed", quitWhenAllWindowsClosed);
