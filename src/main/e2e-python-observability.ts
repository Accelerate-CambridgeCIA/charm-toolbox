import { ipcMain } from "electron";

import { isE2eTestModeEnabled } from "./e2e-dialog-stub";
import { readPythonWorkerSpawnCount } from "./python/python-worker-spawn-count";

// CT-335: e2e proves the ROP session's resident worker by watching how many
// Python interpreters main has spawned (window.toolboxE2E
// .readPythonWorkerSpawnCount). Registered only under MSI_E2E, like the
// dialog stub channels; keep this literal in sync with src/preload/index.ts.
const READ_PYTHON_WORKER_SPAWN_COUNT_CHANNEL = "test:read-python-worker-spawn-count";

export function registerE2ePythonObservabilityChannelsWhenEnabled(): void {
  if (!isE2eTestModeEnabled()) return;
  ipcMain.handle(READ_PYTHON_WORKER_SPAWN_COUNT_CHANNEL, () => readPythonWorkerSpawnCount());
}
