// Integration tests for the subprocess worker harness against the real bundled
// interpreter. The runtime is installed by `node scripts/setup-python-runtime.mjs`;
// on a machine without it, the suite is skipped rather than failing the unit run.
import { execFileSync } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createChunkedUserScriptRunSessionStore,
  type ChunkedUserScriptRunSessionStore,
} from "./chunked-user-script-run";
import {
  encodeCubeAsFloat32Payload,
  encodeMaskCategoriesAsUint8Payload,
  type CubeForUserScript,
} from "./cube-payload";
import { resolveActivePythonInterpreterPath } from "./interpreter-resolver";
import { runUserScriptInPythonSubprocess, type PythonWorkerRunRequest } from "./python-worker";
import { prepareImportedUserScriptFromFilePath } from "./script-import";
import { writeZipArchiveWithEntries } from "./zip-archive-test-helper";

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

describe.skipIf(interpreterPath === null)("python worker integration (bundled runtime)", () => {
  const DEFAULT_TIMEOUT_MS = 30_000;

  function runScript(scriptSource: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: null,
      resultKind: "value",
      sandbox: false,
      timeoutMs,
    });
  }

  function runSandboxedScript(scriptSource: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: null,
      resultKind: "value",
      sandbox: true,
      timeoutMs,
    });
  }

  function runSandboxedFormulaAgainstCube(expression: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "formula", expression },
      cube: encodeCubeAsFloat32Payload(cube),
      resultKind: "value",
      sandbox: true,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  function runFormulaAgainstCube(expression: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "formula", expression },
      cube: encodeCubeAsFloat32Payload(cube),
      resultKind: "value",
      sandbox: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  function runScriptAgainstCube(scriptSource: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: encodeCubeAsFloat32Payload(cube),
      resultKind: "value",
      sandbox: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  async function runImportedZipToolAgainstCube(entries: Record<string, string>, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const workingDirectory = await fs.mkdtemp(path.join(tmpdir(), "msi-imported-tool-test-"));
    const zipPath = path.join(workingDirectory, "tool.zip");
    await writeZipArchiveWithEntries(zipPath, entries);
    const prepared = await prepareImportedUserScriptFromFilePath(zipPath);
    try {
      return await runUserScriptInPythonSubprocess({
        interpreterPath,
        input: prepared.input,
        cube: encodeCubeAsFloat32Payload(cube),
        resultKind: "value",
        sandbox: false,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } finally {
      await prepared.releaseResources();
      await fs.rm(workingDirectory, { recursive: true, force: true });
    }
  }

  function nextCubeResultSpoolPath(): string {
    return path.join(tmpdir(), `msi-worker-test-cube-result-${Date.now()}-${Math.floor(Math.random() * 1e9)}.bin`);
  }

  async function readSpooledFloats(spoolPath: string): Promise<number[]> {
    const bytes = await fs.readFile(spoolPath);
    return Array.from(new Float32Array(new Uint8Array(bytes).buffer));
  }

  function runFormulaForCubeResult(expression: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "formula", expression },
      cube: encodeCubeAsFloat32Payload(cube),
      resultKind: "cube",
      cubeResultSpoolPath: nextCubeResultSpoolPath(),
      sandbox: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  function runSandboxedCubeTransformScript(scriptSource: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: encodeCubeAsFloat32Payload(cube),
      resultKind: "cube",
      cubeResultSpoolPath: nextCubeResultSpoolPath(),
      sandbox: true,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  const sampleCube: CubeForUserScript = {
    bands: [Float32Array.from([1, 2, 3, 4]), Float32Array.from([10, 20, 30, 40])],
    height: 2,
    width: 2,
    wavelengths: [500, 600],
  };

  it("runs a trivial script via the bundled interpreter and returns its result", async () => {
    const outcome = await runScript("def run():\n    return 21 * 2\n");
    expect(outcome).toEqual({ kind: "completed", value: 42 });
  }, 60_000);

  it("imports the curated stack (numpy, scipy, scikit-image) inside the worker", async () => {
    const outcome = await runScript(
      [
        "def run():",
        "    import numpy",
        "    import scipy",
        "    import skimage",
        "    return [numpy.__version__, scipy.__version__, skimage.__version__]",
        "",
      ].join("\n"),
    );
    expect(outcome).toEqual({ kind: "completed", value: ["2.5.0", "1.18.0", "0.26.0"] });
  }, 120_000);

  it("kills a runaway script at the wall-clock limit and surfaces a user-facing error", async () => {
    const outcome = await runScript("def run():\n    while True:\n        pass\n", 1_500);
    expect(outcome).toEqual({
      kind: "failed",
      reason: "timeout",
      userFacingMessage: "The script exceeded the 1.5-second limit and was stopped.",
    });
  }, 60_000);

  it("surfaces a raising script as a script error, not a crash", async () => {
    const outcome = await runScript("def run():\n    raise ValueError('bad wavelength')\n");
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: "The script failed: bad wavelength",
    });
  }, 60_000);

  it("surfaces a script without a run() function as a script error", async () => {
    const outcome = await runScript("answer = 42\n");
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: "The script failed: The script must define a run() function.",
    });
  }, 60_000);

  it("does not let user print() output corrupt the response framing", async () => {
    const outcome = await runScript("def run():\n    print('progress noise')\n    return 'ok'\n");
    expect(outcome).toEqual({ kind: "completed", value: "ok" });
  }, 60_000);

  it("runs an inline formula returning a weight vector, matching a pure-TS reference", async () => {
    const outcome = await runFormulaAgainstCube("cube.mean(axis=(1, 2))", sampleCube);
    const expectedBandMeans = sampleCube.bands.map((band) => band.reduce((s, v) => s + v, 0) / band.length);
    expect(outcome).toEqual({ kind: "completed", value: expectedBandMeans });
  }, 60_000);

  it("runs an inline formula returning an H x W band, matching a pure-TS reference", async () => {
    const outcome = await runFormulaAgainstCube("cube[1] - cube[0]", sampleCube);
    expect(outcome).toEqual({
      kind: "completed",
      value: [
        [9, 18],
        [27, 36],
      ],
    });
  }, 60_000);

  it("rejects a multi-statement formula with a clear single-expression error", async () => {
    const outcome = await runFormulaAgainstCube("weights = cube.mean(axis=(1, 2))", sampleCube);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: expect.stringContaining("A formula must be a single Python expression"),
    });
  }, 60_000);

  it("passes wavelengths through to an imported-style run(cube, wavelengths=None)", async () => {
    const outcome = await runScriptAgainstCube(
      "def run(cube, wavelengths=None):\n    return list(wavelengths)\n",
      sampleCube,
    );
    expect(outcome).toEqual({ kind: "completed", value: [500, 600] });
  }, 60_000);

  it("surfaces a script that returns NaN as a script error, not invalid JSON", async () => {
    const outcome = await runFormulaAgainstCube("cube * float('nan')", sampleCube);
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
  }, 60_000);

  it("runs an imported multi-module .zip tool, matching a pure-TS reference", async () => {
    const outcome = await runImportedZipToolAgainstCube(
      {
        "main.py": "from combine import combine_bands\n\n\ndef run(cube, wavelengths=None):\n    return combine_bands(cube)\n",
        "combine.py": "def combine_bands(cube):\n    return cube[0] * 2 - cube[1]\n",
      },
      sampleCube,
    );
    const expectedBand = combinePerPixelReference(sampleCube, (first, second) => first * 2 - second);
    expect(outcome).toEqual({ kind: "completed", value: expectedBand });
  }, 60_000);

  it("surfaces an imported .zip whose main.py has no run() as a script error", async () => {
    const outcome = await runImportedZipToolAgainstCube({ "main.py": "answer = 42\n" }, sampleCube);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: "The script failed: The tool's main.py must define a run() function.",
    });
  }, 60_000);

  it("still runs a legitimate numpy computation under the bundled sandbox", async () => {
    const outcome = await runSandboxedFormulaAgainstCube("cube.mean(axis=(1, 2))", sampleCube);
    const expectedBandMeans = sampleCube.bands.map((band) => band.reduce((s, v) => s + v, 0) / band.length);
    expect(outcome).toEqual({ kind: "completed", value: expectedBandMeans });
  }, 60_000);

  it("denies filesystem writes to a sandboxed script", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    open(r'C:/msi-sandbox-probe.txt', 'w').write('x')\n    return 'wrote'\n",
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("blocked in bundled mode");
  }, 60_000);

  it("denies reading an arbitrary file outside the runtime from a sandboxed script", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    open(r'C:/Windows/win.ini', 'r').read()\n    return 'read'\n",
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("filesystem");
  }, 60_000);

  it("denies opening a network connection from a sandboxed script", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    import socket\n    socket.socket().connect(('127.0.0.1', 9))\n    return 'connected'\n",
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("blocked in bundled mode");
  }, 60_000);

  it("rejects a fresh user import of a non-allowlisted module under the bundled sandbox", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    import urllib.request\n    return 'imported'\n",
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("blocked in bundled mode");
  }, 60_000);

  it("still allows a fresh user import of an allowlisted module under the bundled sandbox", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    import statistics\n    return statistics.mean([1, 2, 3])\n",
    );
    expect(outcome).toEqual({ kind: "completed", value: 2 });
  }, 60_000);

  it("rejects importing an unbundled package (statsmodels) in bundled mode, pointing at Custom Script > Python Environment", async () => {
    const outcome = await runSandboxedScript("def run():\n    import statsmodels\n    return 'imported'\n");
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    const message = (outcome as { userFacingMessage: string }).userFacingMessage;
    expect(message).toContain("import 'statsmodels'");
    expect(message).toContain("blocked in bundled mode");
    expect(message).toContain("Custom Script > Python Environment");
  }, 60_000);

  function listBundledRuntimeImportNames(): string[] {
    const manifestPath = path.join(process.cwd(), "scripts", "python-runtime-packages.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      packages: Array<{ importName: string }>;
    };
    return manifest.packages.map((entry) => entry.importName);
  }

  it("imports every bundled runtime package inside the sandboxed worker", async () => {
    const importNames = listBundledRuntimeImportNames();
    const script = [
      "def run():",
      "    import importlib",
      `    names = ${JSON.stringify(importNames)}`,
      "    return {name: getattr(importlib.import_module(name), '__version__', 'present') for name in names}",
      "",
    ].join("\n");
    const outcome = await runSandboxedScript(script, 120_000);
    if (outcome.kind !== "completed") throw new Error(`bundled imports failed: ${JSON.stringify(outcome)}`);
    expect(Object.keys(outcome.value as Record<string, string>).sort()).toEqual([...importNames].sort());
  }, 180_000);

  function venvPythonExecutablePath(venvDirectory: string): string {
    return process.platform === "win32"
      ? path.join(venvDirectory, "Scripts", "python.exe")
      : path.join(venvDirectory, "bin", "python");
  }

  function queryVenvSitePackagesDirectory(venvPython: string): string {
    const printPurelib = "import sysconfig; print(sysconfig.get_paths()['purelib'])";
    return execFileSync(venvPython, ["-c", printPurelib], { encoding: "utf8" }).trim();
  }

  // Builds the smallest honest "own environment": a venv off the bundled
  // interpreter whose site-packages holds a module the bundle does not ship.
  async function createOwnEnvironmentContainingLocalOnlyPackage(venvDirectory: string): Promise<string> {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    execFileSync(interpreterPath, ["-m", "venv", "--without-pip", venvDirectory]);
    const venvPython = venvPythonExecutablePath(venvDirectory);
    const sitePackages = queryVenvSitePackagesDirectory(venvPython);
    await fs.writeFile(path.join(sitePackages, "local_only_probe_package.py"), "PROBE_VALUE = 12345\n");
    return venvPython;
  }

  function runOwnEnvironmentScript(ownInterpreterPath: string, scriptSource: string) {
    return runUserScriptInPythonSubprocess({
      interpreterPath: ownInterpreterPath,
      input: { kind: "script", scriptSource },
      cube: null,
      resultKind: "value",
      sandbox: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  it("runs a script importing a locally installed, unbundled package through an own-environment interpreter", async () => {
    const venvDirectory = await fs.mkdtemp(path.join(tmpdir(), "msi-own-env-test-"));
    try {
      const ownInterpreterPath = await createOwnEnvironmentContainingLocalOnlyPackage(venvDirectory);
      const outcome = await runOwnEnvironmentScript(
        ownInterpreterPath,
        "def run():\n    import local_only_probe_package\n    return local_only_probe_package.PROBE_VALUE\n",
      );
      expect(outcome).toEqual({ kind: "completed", value: 12345 });
    } finally {
      await fs.rm(venvDirectory, { recursive: true, force: true });
    }
  }, 120_000);

  it("returns a doubled cube from a cube-result formula, matching a pure-TS reference", async () => {
    const outcome = await runFormulaForCubeResult("cube * 2", sampleCube);
    if (outcome.kind !== "completed-cube") throw new Error(`unexpected outcome ${JSON.stringify(outcome)}`);
    expect(outcome.shape).toEqual([2, 2, 2]);
    expect(outcome.totalBytes).toBe(32);
    const expectedValues = sampleCube.bands.flatMap((band) => Array.from(band, (value) => value * 2));
    expect(await readSpooledFloats(outcome.spoolPath)).toEqual(expectedValues);
    await fs.rm(outcome.spoolPath, { force: true });
  }, 60_000);

  it("rejects a 2-dimensional return from a cube-result run as a script error", async () => {
    const outcome = await runFormulaForCubeResult("cube[0]", sampleCube);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: expect.stringContaining("(bands, height, width)"),
    });
  }, 60_000);

  it("rejects a NaN-containing return from a cube-result run as a script error", async () => {
    const outcome = await runFormulaForCubeResult("cube * float('nan')", sampleCube);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: expect.stringContaining("finite"),
    });
  }, 60_000);

  // CT-219g: proves the chunked transfer chain at a size spanning many chunks
  // (~100 MB cube, byte-misaligned upload pieces, multi-chunk result pull),
  // composing the session store with a real worker run exactly like the IPC layer.
  it("round-trips a multi-chunk large cube through the chunked session store and the worker", async () => {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const bandCount = 6;
    const height = 2048;
    const width = 2048;
    const store = createChunkedUserScriptRunSessionStore(8 * 1024 * 1024);
    const token = await store.begin({
      cube: { bandCount, height, width, wavelengths: null },
      resultKind: "cube",
      input: { kind: "formula", expression: "cube * 2" },
      releaseInputResources: () => Promise.resolve(),
      sourceName: null,
      interpreterPath,
      sandbox: true,
    });
    await uploadSyntheticBandsInMisalignedChunks(store, token, bandCount, height * width);
    const run = store.takeExecutableRun(token);
    const outcome = await runUserScriptInPythonSubprocess({
      interpreterPath: run.interpreterPath,
      input: run.input,
      cube: run.cube,
      resultKind: run.resultKind,
      cubeResultSpoolPath: run.cubeResultSpoolPath,
      sandbox: run.sandbox,
      timeoutMs: 120_000,
    });
    if (outcome.kind !== "completed-cube") {
      throw new Error(`unexpected outcome ${JSON.stringify(outcome)}`);
    }
    expect(outcome.shape).toEqual([bandCount, height, width]);
    store.storeCubeResultForPull(token, outcome.shape, outcome.totalBytes);
    const bands = await pullAllResultBandsFromStore(store, token, bandCount, height * width);
    expectDoubledSyntheticSpotValues(bands, height * width);
    await store.release(token);
  }, 240_000);

  it("still enforces the bundled sandbox for a cube-transform run", async () => {
    const outcome = await runSandboxedCubeTransformScript(
      "def run(cube, wavelengths=None):\n    open(r'C:/msi-sandbox-probe.txt', 'w').write('x')\n    return cube\n",
      sampleCube,
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("blocked in bundled mode");
  }, 60_000);

  it("still kills a runaway sandboxed script at the wall-clock limit", async () => {
    const outcome = await runSandboxedScript("def run():\n    while True:\n        pass\n", 1_500);
    expect(outcome).toEqual({
      kind: "failed",
      reason: "timeout",
      userFacingMessage: "The script exceeded the 1.5-second limit and was stopped.",
    });
  }, 60_000);
});

const SYNTHETIC_VALUE_MODULUS = 977;
const SYNTHETIC_UPLOAD_PIECE_BYTES = 7_000_003;

function syntheticBandValue(bandIndex: number, pixelIndex: number): number {
  return (bandIndex + 1) * 1000 + (pixelIndex % SYNTHETIC_VALUE_MODULUS);
}

function buildSyntheticBand(bandIndex: number, pixelCount: number): Float32Array {
  const band = new Float32Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    band[pixelIndex] = syntheticBandValue(bandIndex, pixelIndex);
  }
  return band;
}

// Piece size is deliberately NOT a multiple of 4, so chunk boundaries fall
// inside float32 samples and across band boundaries, like real IPC chunks may.
async function uploadSyntheticBandsInMisalignedChunks(
  store: ChunkedUserScriptRunSessionStore,
  token: string,
  bandCount: number,
  pixelCount: number,
): Promise<void> {
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const bytes = new Uint8Array(buildSyntheticBand(bandIndex, pixelCount).buffer);
    for (let offset = 0; offset < bytes.byteLength; offset += SYNTHETIC_UPLOAD_PIECE_BYTES) {
      await store.appendCubeChunk(token, bytes.subarray(offset, offset + SYNTHETIC_UPLOAD_PIECE_BYTES));
    }
  }
}

async function pullAllResultBandsFromStore(
  store: ChunkedUserScriptRunSessionStore,
  token: string,
  bandCount: number,
  pixelCount: number,
): Promise<Float32Array[]> {
  const combined = new Uint8Array(bandCount * pixelCount * 4);
  let offset = 0;
  let done = false;
  while (!done) {
    const chunk = await store.readNextResultChunk(token);
    combined.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
    done = chunk.done;
  }
  expect(offset).toBe(combined.byteLength);
  return Array.from({ length: bandCount }, (_, bandIndex) =>
    new Float32Array(combined.buffer, bandIndex * pixelCount * 4, pixelCount),
  );
}

function expectDoubledSyntheticSpotValues(bands: Float32Array[], pixelCount: number): void {
  const spots = [0, 1, SYNTHETIC_VALUE_MODULUS - 1, SYNTHETIC_VALUE_MODULUS, Math.floor(pixelCount / 2), pixelCount - 1];
  bands.forEach((band, bandIndex) => {
    for (const pixelIndex of spots) {
      expect(band[pixelIndex]).toBe(2 * syntheticBandValue(bandIndex, pixelIndex));
    }
  });
}

function combinePerPixelReference(
  cube: CubeForUserScript,
  combineTwoBands: (first: number, second: number) => number,
): number[][] {
  const rows: number[][] = [];
  for (let row = 0; row < cube.height; row += 1) {
    rows.push(buildCombinedRow(cube, row, combineTwoBands));
  }
  return rows;
}

function buildCombinedRow(
  cube: CubeForUserScript,
  row: number,
  combineTwoBands: (first: number, second: number) => number,
): number[] {
  const columns: number[] = [];
  for (let column = 0; column < cube.width; column += 1) {
    const pixelIndex = row * cube.width + column;
    columns.push(combineTwoBands(cube.bands[0]![pixelIndex]!, cube.bands[1]![pixelIndex]!));
  }
  return columns;
}

// CT-307: params, masks, in-script progress, and built-in script loading.
describe.skipIf(interpreterPath === null)("python worker CT-307 additions (bundled runtime)", () => {
  const TIMEOUT_MS = 30_000;

  const paramsCube: CubeForUserScript = {
    bands: [Float32Array.from([1, 2, 3, 4])],
    height: 2,
    width: 2,
    wavelengths: null,
  };

  // CT-318: two bands whose categories separate differently, and over
  // different value ranges, so a per-band score cannot be faked by pooling.
  const perBandNpcCube: CubeForUserScript = {
    bands: [Float32Array.from([1, 2, 3, 4]), Float32Array.from([10, 40, 20, 30])],
    height: 2,
    width: 2,
    wavelengths: null,
  };

  function encodeTwoMaskCategories() {
    return encodeMaskCategoriesAsUint8Payload({
      categories: [Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([0, 0, 1, 1])],
      height: 2,
      width: 2,
    });
  }

  function runScriptWithExtras(
    scriptSource: string,
    extras: Partial<PythonWorkerRunRequest>,
  ): ReturnType<typeof runUserScriptInPythonSubprocess> {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: encodeCubeAsFloat32Payload(paramsCube),
      resultKind: "value",
      sandbox: false,
      timeoutMs: TIMEOUT_MS,
      ...extras,
    });
  }

  it("passes the params dict as the third positional argument", async () => {
    const outcome = await runScriptWithExtras(
      "def run(cube, wavelengths, params):\n    return params['gain'] * float(cube[0][0][0])\n",
      { params: { gain: 3 } },
    );
    expect(outcome).toEqual({ kind: "completed", value: 3 });
  }, 60_000);

  it("keeps 2-arity scripts working when params ride the request (arity compatibility)", async () => {
    const outcome = await runScriptWithExtras(
      "def run(cube, wavelengths=None):\n    return float(cube.sum())\n",
      { params: { ignored: true } },
    );
    expect(outcome).toEqual({ kind: "completed", value: 10 });
  }, 60_000);

  it("delivers masks as per-category uint8 numpy arrays of shape (height, width)", async () => {
    const outcome = await runScriptWithExtras(
      [
        "def run(cube, wavelengths, params):",
        "    masks = params['masks']",
        "    return {",
        "        'count': len(masks),",
        "        'shapes': [list(m.shape) for m in masks],",
        "        'dtypes': [str(m.dtype) for m in masks],",
        "        'sums': [int(m.sum()) for m in masks],",
        "    }",
        "",
      ].join("\n"),
      { masks: encodeTwoMaskCategories() },
    );
    expect(outcome).toEqual({
      kind: "completed",
      value: {
        count: 2,
        shapes: [
          [2, 2],
          [2, 2],
        ],
        dtypes: ["uint8", "uint8"],
        sums: [2, 2],
      },
    });
  }, 60_000);

  it("streams in-script progress frames to onProgress without settling the run", async () => {
    const fractions: number[] = [];
    const outcome = await runScriptWithExtras(
      [
        "def run(cube, wavelengths, params):",
        "    report = params['report_progress']",
        "    report(0.25)",
        "    report(0.75)",
        "    report(1.0)",
        "    return 'done'",
        "",
      ].join("\n"),
      { onProgress: (fraction) => fractions.push(fraction) },
    );
    expect(outcome).toEqual({ kind: "completed", value: "done" });
    expect(fractions).toEqual([0.25, 0.75, 1]);
  }, 60_000);

  it("runs a built-in script from the repo's builtin directory under the sandbox", async () => {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const outcome = await runUserScriptInPythonSubprocess({
      interpreterPath,
      input: {
        kind: "builtin",
        directory: path.join(process.cwd(), "resources", "builtin-python"),
        moduleName: "npc",
      },
      cube: encodeCubeAsFloat32Payload(perBandNpcCube),
      masks: encodeTwoMaskCategories(),
      params: { bins: 2 },
      resultKind: "value",
      sandbox: true,
      timeoutMs: 120_000,
    });
    // CT-318: one score PER BAND, each binned over THAT BAND's own min-max.
    // Band 1 {1, 2} vs {3, 4} splits cleanly over [1, 4], so it scores 1; band 2
    // {10, 40} vs {20, 30} straddles both bins of [10, 40], so it scores 0.
    // Pooling the bands would read 0.5, and binning band 1 over the whole
    // cube's [1, 40] would read 0: only per-band scoring gives [1, 0].
    expect(outcome).toEqual({ kind: "completed", value: [1, 0] });
  }, 120_000);

  it("draws identical ROP projections for the same seed across two runs", async () => {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const runOnce = (): ReturnType<typeof runUserScriptInPythonSubprocess> =>
      runUserScriptInPythonSubprocess({
        interpreterPath: interpreterPath!,
        input: {
          kind: "builtin",
          directory: path.join(process.cwd(), "resources", "builtin-python"),
          moduleName: "rop",
        },
        cube: encodeCubeAsFloat32Payload(paramsCube),
        params: { seed: 1234, count: 1 },
        resultKind: "cube",
        cubeResultSpoolPath: nextSpoolPathForCt307(),
        sandbox: true,
        timeoutMs: 120_000,
      });
    const first = await runOnce();
    const second = await runOnce();
    expect(first.kind).toBe("completed-cube");
    expect(second.kind).toBe("completed-cube");
    if (first.kind !== "completed-cube" || second.kind !== "completed-cube") return;
    expect(await readFloatsFromSpool(first.spoolPath)).toEqual(
      await readFloatsFromSpool(second.spoolPath),
    );
  }, 240_000);
});

function nextSpoolPathForCt307(): string {
  return path.join(
    tmpdir(),
    `msi-worker-test-ct307-${Date.now()}-${Math.floor(Math.random() * 1e9)}.bin`,
  );
}

async function readFloatsFromSpool(spoolPath: string): Promise<number[]> {
  const bytes = await fs.readFile(spoolPath);
  return Array.from(new Float32Array(new Uint8Array(bytes).buffer));
}

// CT-310: the ROP optimization search. These run the PACKAGED rop_search.py
// under the bundled sandbox, which is also what proves its sibling imports
// (rop, npc) survive the sandbox's import allowlist.
describe.skipIf(interpreterPath === null)("python worker CT-310 additions (bundled runtime)", () => {
  const searchCube: CubeForUserScript = {
    bands: [Float32Array.from([1, 2, 3, 4]), Float32Array.from([10, 20, 30, 40])],
    height: 2,
    width: 2,
    wavelengths: null,
  };

  const textThenBackgroundMasks = {
    categories: [Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([0, 0, 1, 1])],
    height: 2,
    width: 2,
  };

  function runSearch(
    params: Record<string, string | number>,
    extras: Partial<PythonWorkerRunRequest> = {},
  ): ReturnType<typeof runUserScriptInPythonSubprocess> {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: {
        kind: "builtin",
        directory: path.join(process.cwd(), "resources", "builtin-python"),
        moduleName: "rop_search",
      },
      cube: encodeCubeAsFloat32Payload(searchCube),
      masks: encodeMaskCategoriesAsUint8Payload(textThenBackgroundMasks),
      params,
      resultKind: "cube",
      cubeResultSpoolPath: nextSpoolPathForCt307(),
      sandbox: true,
      timeoutMs: 120_000,
      ...extras,
    });
  }

  // A single-candidate search must land on exactly the candidate rop.py draws
  // with the same seed: that shared draw is what lets the panel's presses and
  // its search explore one sequence.
  it("draws its candidates through rop.py, so a one-candidate search equals one press", async () => {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const searched = await runSearch({ seed: 4242, count: 1, objective: "cnr", text_mask_index: 0, background_mask_index: 1 });
    const pressed = await runUserScriptInPythonSubprocess({
      interpreterPath,
      input: {
        kind: "builtin",
        directory: path.join(process.cwd(), "resources", "builtin-python"),
        moduleName: "rop",
      },
      cube: encodeCubeAsFloat32Payload(searchCube),
      params: { seed: 4242, count: 1 },
      resultKind: "cube",
      cubeResultSpoolPath: nextSpoolPathForCt307(),
      sandbox: true,
      timeoutMs: 120_000,
    });
    expect(searched.kind).toBe("completed-cube");
    expect(pressed.kind).toBe("completed-cube");
    if (searched.kind !== "completed-cube" || pressed.kind !== "completed-cube") return;
    expect(searched.shape).toEqual([1, 2, 2]);
    expect(await readFloatsFromSpool(searched.spoolPath)).toEqual(
      await readFloatsFromSpool(pressed.spoolPath),
    );
  }, 240_000);

  it("keeps the best-scoring candidate of a many-candidate CNR search", async () => {
    const winner = await runSearch({
      seed: 99,
      count: 25,
      objective: "cnr",
      text_mask_index: 0,
      background_mask_index: 1,
    });
    expect(winner.kind).toBe("completed-cube");
    if (winner.kind !== "completed-cube") return;
    const values = await readFloatsFromSpool(winner.spoolPath);
    // Text = the top row, background = the bottom row. CT-322: CNR scores the
    // ABSOLUTE mean difference, so the winner may separate in either direction -
    // what a real search must find is SOME separation, not a degenerate tie.
    const cnrSign = Math.sign((values[0]! + values[1]!) / 2 - (values[2]! + values[3]!) / 2);
    expect(Math.abs(cnrSign)).toBe(1);
  }, 240_000);

  it("scores every candidate with a custom objective script's source, in-sandbox", async () => {
    const objectiveSource = [
      "import numpy as np",
      "",
      "",
      "def run(cube, wavelengths, params):",
      "    return float(np.mean(cube[0]))",
      "",
    ].join("\n");
    const winner = await runSearch({
      seed: 7,
      count: 25,
      objective: "custom",
      objective_source: objectiveSource,
    });
    expect(winner.kind).toBe("completed-cube");
    if (winner.kind !== "completed-cube") return;
    const values = await readFloatsFromSpool(winner.spoolPath);
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0);
  }, 240_000);

  it("scores candidates with the built-in NPC objective through its sibling module", async () => {
    const winner = await runSearch({ seed: 11, count: 5, objective: "npc", bins: 2 });
    expect(winner.kind).toBe("completed-cube");
    if (winner.kind !== "completed-cube") return;
    expect(winner.shape).toEqual([1, 2, 2]);
  }, 240_000);

  // The wall clock exists to kill a WEDGED worker. A long search reports
  // progress the whole time, and each report buys it another full budget.
  it("keeps a progress-reporting script alive past its wall-clock budget", async () => {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const outcome = await runUserScriptInPythonSubprocess({
      interpreterPath,
      input: {
        kind: "script",
        scriptSource: [
          "import time",
          "",
          "",
          "def run(cube, wavelengths, params):",
          "    report = params['report_progress']",
          "    for step in range(12):",
          "        time.sleep(0.25)",
          "        report((step + 1) / 12)",
          "    return 'survived'",
          "",
        ].join("\n"),
      },
      cube: encodeCubeAsFloat32Payload(searchCube),
      resultKind: "value",
      sandbox: false,
      timeoutMs: 1_500,
    });
    expect(outcome).toEqual({ kind: "completed", value: "survived" });
  }, 60_000);

  it("reports determinate progress while it loops and refuses an unknown objective", async () => {
    const fractions: number[] = [];
    const progressed = await runSearch(
      { seed: 5, count: 300, objective: "cnr", text_mask_index: 0, background_mask_index: 1 },
      { onProgress: (fraction) => fractions.push(fraction) },
    );
    expect(progressed.kind).toBe("completed-cube");
    expect(fractions.length).toBeGreaterThan(1);
    expect(fractions[fractions.length - 1]).toBe(1);

    const refused = await runSearch({ seed: 5, count: 2, objective: "mystery" });
    expect(refused.kind).toBe("failed");
    if (refused.kind !== "failed") return;
    expect(refused.userFacingMessage).toContain("objective");
  }, 240_000);
});
