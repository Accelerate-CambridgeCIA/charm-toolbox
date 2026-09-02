import type { Page } from "@playwright/test";

interface ToolboxE2eBridge {
  enqueueOpenDialogPaths: (filePaths: ReadonlyArray<string>) => Promise<void>;
  enqueueSaveDialogPath: (filePath: string) => Promise<void>;
  resetDialogQueues: () => Promise<void>;
  // CT-316: the forced ROP seed can be changed between presses (rop-panel.ts).
  readRopForcedSeedOverride: () => number | null;
  setRopForcedSeedOverride: (seed: number | null) => void;
  // CT-335: interpreter spawns since launch, one-shot and resident alike.
  readPythonWorkerSpawnCount: () => Promise<number>;
}

declare global {
  interface Window {
    toolboxE2E: ToolboxE2eBridge;
  }
}

export async function enqueueOpenDialogPaths(
  page: Page,
  filePaths: ReadonlyArray<string>,
): Promise<void> {
  await page.evaluate(
    (paths) => window.toolboxE2E.enqueueOpenDialogPaths(paths),
    filePaths,
  );
}

export async function enqueueSaveDialogPath(page: Page, filePath: string): Promise<void> {
  await page.evaluate((path) => window.toolboxE2E.enqueueSaveDialogPath(path), filePath);
}

export async function resetDialogQueues(page: Page): Promise<void> {
  await page.evaluate(() => window.toolboxE2E.resetDialogQueues());
}

// CT-335: how many Python interpreters main has spawned since launch; a
// resident ROP session raises it by exactly one across many presses.
export async function readPythonWorkerSpawnCount(page: Page): Promise<number> {
  return page.evaluate(() => window.toolboxE2E.readPythonWorkerSpawnCount());
}
