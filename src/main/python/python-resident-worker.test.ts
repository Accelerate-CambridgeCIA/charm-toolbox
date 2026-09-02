// CT-334: integration tests for the resident session worker against the real
// bundled interpreter, driving stub built-in modules written to a temp
// directory (the python-worker.test.ts pattern: resolve the dev runtime, skip
// the suite when it is not installed).
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encodeCubeAsFloat32Payload, type CubeForUserScript } from "./cube-payload";
import { resolveActivePythonInterpreterPath } from "./interpreter-resolver";
import {
  spawnResidentPythonWorker,
  type ResidentExecuteBuiltin,
  type ResidentPythonWorker,
} from "./python-resident-worker";

function tryResolveDevelopmentInterpreterPathOrNull(): string | null {
  try {
    return resolveActivePythonInterpreterPath({
      isPackagedApp: false,
      packagedResourcesPath: "",
      developmentRepoRootPath: process.cwd(),
      platform: process.platform,
      fileExists: existsSync,
    });
  } catch {
    return null;
  }
}

const interpreterPath = tryResolveDevelopmentInterpreterPathOrNull();

const STUB_BUILTIN_MODULES: Record<string, string> = {
  "worker_pid.py": "import os\n\n\ndef run(cube, wavelengths, params):\n    return os.getpid()\n",
  "report_half.py":
    "def run(cube, wavelengths, params):\n    params['report_progress'](0.5)\n    return 'reported'\n",
  "sleep_forever.py":
    "import time\n\n\ndef run(cube, wavelengths, params):\n    time.sleep(600)\n    return 'never'\n",
  "exit_after_reply.py":
    "import os\nimport threading\n\n\ndef run(cube, wavelengths, params):\n    threading.Timer(0.2, os._exit, [3]).start()\n    return 'bye'\n",
  "scale_cube.py": "def run(cube, wavelengths, params):\n    return cube * params['gain']\n",
};

const sampleCube: CubeForUserScript = {
  bands: [Float32Array.from([1, 2, 3, 4])],
  height: 2,
  width: 2,
  wavelengths: null,
};

function delayMilliseconds(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitUntilTrue(condition: () => boolean, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitUntilTrue: condition never became true");
    await delayMilliseconds(50);
  }
}

describe.skipIf(interpreterPath === null)("resident python worker (bundled runtime)", () => {
  let builtinDirectory = "";

  beforeAll(async () => {
    builtinDirectory = await fs.mkdtemp(path.join(tmpdir(), "msi-resident-worker-test-"));
    for (const [fileName, source] of Object.entries(STUB_BUILTIN_MODULES)) {
      await fs.writeFile(path.join(builtinDirectory, fileName), source);
    }
  });

  afterAll(async () => {
    await fs.rm(builtinDirectory, { recursive: true, force: true });
  });

  function stubBuiltin(moduleName: string): ResidentExecuteBuiltin {
    return { directory: builtinDirectory, moduleName };
  }

  function spawnValueSessionWorker(timeoutMs = 60_000): ResidentPythonWorker {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return spawnResidentPythonWorker({
      interpreterPath,
      input: stubSessionInput("worker_pid"),
      cube: encodeCubeAsFloat32Payload(sampleCube),
      resultKind: "value",
      sandbox: false,
      timeoutMs,
    });
  }

  function stubSessionInput(moduleName: string): {
    kind: "builtin";
    directory: string;
    moduleName: string;
  } {
    return { kind: "builtin", directory: builtinDirectory, moduleName };
  }

  it("answers two sequential executes with one interpreter process", async () => {
    const worker = spawnValueSessionWorker();
    try {
      const first = await worker.execute(null, stubBuiltin("worker_pid"), null);
      const second = await worker.execute(null, stubBuiltin("worker_pid"), null);
      expect(first.kind).toBe("completed");
      if (first.kind !== "completed") return;
      expect(typeof first.value).toBe("number");
      expect(second).toEqual(first);
    } finally {
      worker.kill();
    }
  }, 60_000);

  it("resets the in-script progress baseline for every execute", async () => {
    const worker = spawnValueSessionWorker();
    try {
      const firstFractions: number[] = [];
      const secondFractions: number[] = [];
      await worker.execute(null, stubBuiltin("report_half"), null, {
        onProgress: (fraction) => firstFractions.push(fraction),
      });
      await worker.execute(null, stubBuiltin("report_half"), null, {
        onProgress: (fraction) => secondFractions.push(fraction),
      });
      // Without the per-execute reset the rate limiter would swallow the
      // second execute's 0.5 (a repeat of the last reported fraction).
      expect(firstFractions).toEqual([0.5]);
      expect(secondFractions).toEqual([0.5]);
    } finally {
      worker.kill();
    }
  }, 60_000);

  it("settles a kill mid-execute as canceled", async () => {
    const worker = spawnValueSessionWorker(600_000);
    const pending = worker.execute(null, stubBuiltin("sleep_forever"), null);
    await delayMilliseconds(400);
    worker.kill();
    expect(await pending).toEqual({
      kind: "failed",
      reason: "canceled",
      userFacingMessage: "The script run was stopped.",
    });
    expect(worker.isAlive()).toBe(false);
  }, 60_000);

  it("reports a process exit between executes via isAlive and settles the next execute as worker-crashed", async () => {
    const worker = spawnValueSessionWorker();
    try {
      const farewell = await worker.execute(null, stubBuiltin("exit_after_reply"), null);
      expect(farewell).toEqual({ kind: "completed", value: "bye" });
      await waitUntilTrue(() => !worker.isAlive(), 10_000);
      const next = await worker.execute(null, stubBuiltin("worker_pid"), null);
      expect(next).toMatchObject({ kind: "failed", reason: "worker-crashed" });
    } finally {
      worker.kill();
    }
  }, 60_000);

  it("fires the per-execute timeout on a stalled second execute", async () => {
    const worker = spawnValueSessionWorker(8_000);
    try {
      const first = await worker.execute(null, stubBuiltin("worker_pid"), null);
      expect(first.kind).toBe("completed");
      const stalled = await worker.execute(null, stubBuiltin("sleep_forever"), null);
      expect(stalled).toEqual({
        kind: "failed",
        reason: "timeout",
        userFacingMessage: "The script exceeded the 8-second limit and was stopped.",
      });
      expect(worker.isAlive()).toBe(false);
    } finally {
      worker.kill();
    }
  }, 60_000);

  it("spools each cube execute's result to its own path from the once-loaded cube", async () => {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const worker = spawnResidentPythonWorker({
      interpreterPath,
      input: stubSessionInput("scale_cube"),
      cube: encodeCubeAsFloat32Payload(sampleCube),
      resultKind: "cube",
      sandbox: false,
      timeoutMs: 60_000,
    });
    const doubledPath = nextResultSpoolPath();
    const tripledPath = nextResultSpoolPath();
    try {
      const doubled = await worker.execute({ gain: 2 }, stubBuiltin("scale_cube"), doubledPath);
      const tripled = await worker.execute({ gain: 3 }, stubBuiltin("scale_cube"), tripledPath);
      expect(doubled).toEqual({ kind: "completed-cube", shape: [1, 2, 2], totalBytes: 16, spoolPath: doubledPath });
      expect(tripled).toEqual({ kind: "completed-cube", shape: [1, 2, 2], totalBytes: 16, spoolPath: tripledPath });
      expect(await readSpooledFloats(doubledPath)).toEqual([2, 4, 6, 8]);
      expect(await readSpooledFloats(tripledPath)).toEqual([3, 6, 9, 12]);
    } finally {
      worker.kill();
      await fs.rm(doubledPath, { force: true });
      await fs.rm(tripledPath, { force: true });
    }
  }, 60_000);
});

function nextResultSpoolPath(): string {
  return path.join(
    tmpdir(),
    `msi-resident-worker-test-${Date.now()}-${Math.floor(Math.random() * 1e9)}.bin`,
  );
}

async function readSpooledFloats(spoolPath: string): Promise<number[]> {
  const bytes = await fs.readFile(spoolPath);
  return Array.from(new Float32Array(new Uint8Array(bytes).buffer));
}
