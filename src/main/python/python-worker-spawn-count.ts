// CT-335: e2e-only observability - how many Python interpreters main has
// spawned since launch, one-shot and resident alike (both go through
// spawnPythonWorkerProcess). The count proves the ROP session's resident
// worker from outside: three presses must raise it by exactly one. Gated on
// the MSI_E2E environment flag like the rest of the test surface, so a
// production build never counts; the read channel registers only in e2e mode
// too (src/main/e2e-python-observability.ts).

let spawnedPythonWorkerCount = 0;

function isE2eSpawnCountingEnabled(): boolean {
  return process.env["MSI_E2E"] === "1";
}

export function recordPythonWorkerSpawnWhenE2eEnabled(): void {
  if (!isE2eSpawnCountingEnabled()) return;
  spawnedPythonWorkerCount += 1;
}

export function readPythonWorkerSpawnCount(): number {
  return spawnedPythonWorkerCount;
}
