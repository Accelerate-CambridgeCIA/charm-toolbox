import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createChunkedUserScriptRunSessionStore,
  type BeginChunkedUserScriptRunRequest,
  type ChunkedUserScriptRunSessionStore,
} from "./chunked-user-script-run";
import type { ResidentPythonWorkerSpawnRequest } from "./python-resident-worker";

function buildBeginRequest(
  overrides: Partial<BeginChunkedUserScriptRunRequest> = {},
): BeginChunkedUserScriptRunRequest {
  return {
    cube: { bandCount: 2, height: 2, width: 3, wavelengths: [400, 500] },
    resultKind: "value",
    input: { kind: "formula", expression: "cube.mean()" },
    releaseInputResources: () => Promise.resolve(),
    sourceName: null,
    interpreterPath: "python",
    sandbox: true,
    ...overrides,
  };
}

function float32BytesOf(values: number[]): Uint8Array {
  const floats = Float32Array.from(values);
  return new Uint8Array(floats.buffer.slice(0));
}

// The generator reuses one buffer across yields (consume-before-next-pull
// contract, like the real stdin writer), so each segment is copied here.
async function collectSegments(segments: AsyncIterable<Buffer>): Promise<Uint8Array> {
  const collected: Buffer[] = [];
  for await (const segment of segments) collected.push(Buffer.from(segment));
  return new Uint8Array(Buffer.concat(collected));
}

function buildStore(chunkBytes?: number): ChunkedUserScriptRunSessionStore {
  return createChunkedUserScriptRunSessionStore(chunkBytes, tmpdir());
}

describe("chunked user-script run session store", () => {
  it("spools uploaded chunks and streams the band-major cube payload back in bounded segments", async () => {
    const store = buildStore(10);
    const token = await store.begin(buildBeginRequest());
    const allBytes = float32BytesOf([1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60]);
    await store.appendCubeChunk(token, allBytes.slice(0, 10));
    await store.appendCubeChunk(token, allBytes.slice(10));
    const run = store.takeExecutableRun(token);
    expect(run.cube.header).toEqual({
      shape: [2, 2, 3],
      dtype: "float32",
      wavelengths: [400, 500],
    });
    expect(run.cube.totalByteLength).toBe(allBytes.byteLength);
    expect(await collectSegments(run.cube.readSegments())).toEqual(allBytes);
    expect(run.input).toEqual({ kind: "formula", expression: "cube.mean()" });
    expect(run.sandbox).toBe(true);
    await store.release(token);
  });

  it("rejects a chunk that overflows the described stack shape", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 2, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(8));
    await expect(store.appendCubeChunk(token, new Uint8Array(1))).rejects.toThrow(/did not match/);
    await store.release(token);
  });

  it("rejects an empty chunk", async () => {
    const store = buildStore();
    const token = await store.begin(buildBeginRequest());
    await expect(store.appendCubeChunk(token, new Uint8Array(0))).rejects.toThrow(/did not match/);
    await store.release(token);
  });

  it("refuses to execute before every cube byte arrived", async () => {
    const store = buildStore();
    const token = await store.begin(buildBeginRequest());
    await store.appendCubeChunk(token, new Uint8Array(8));
    expect(() => store.takeExecutableRun(token)).toThrow(/did not match/);
    await store.release(token);
  });

  it("refuses a concurrent execution while one is still in flight", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    store.takeExecutableRun(token);
    expect(() => store.takeExecutableRun(token)).toThrow(/already executing/);
    await store.release(token);
  });

  // CT-307: a session re-executes against the RETAINED spooled cube (ROP's
  // press-to-reroll never re-uploads between presses).
  it("re-executes against the retained spooled cube after the previous run settles", async () => {
    const store = buildStore(10);
    const token = await store.begin(buildBeginRequest());
    const allBytes = float32BytesOf([1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60]);
    await store.appendCubeChunk(token, allBytes.slice(0, 10));
    await store.appendCubeChunk(token, allBytes.slice(10));
    const firstRun = store.takeExecutableRun(token);
    expect(await collectSegments(firstRun.cube.readSegments())).toEqual(allBytes);
    store.markExecutionSettled(token);
    const secondRun = store.takeExecutableRun(token);
    expect(await collectSegments(secondRun.cube.readSegments())).toEqual(allBytes);
    await store.release(token);
  });

  it("refuses more uploaded bytes once the run has executed", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    store.takeExecutableRun(token);
    await expect(store.appendCubeChunk(token, new Uint8Array(4))).rejects.toThrow(
      /already executed/,
    );
    await store.release(token);
  });

  // CT-307: category mask bytes ride the same channel after the cube bytes and
  // come back to the worker as their own framed payload.
  it("frames uploaded mask bytes as a separate payload after the cube bytes", async () => {
    const store = buildStore(10);
    const token = await store.begin(
      buildBeginRequest({
        cube: { bandCount: 1, height: 2, width: 3, wavelengths: null },
        maskCount: 2,
      }),
    );
    const cubeBytes = float32BytesOf([1, 2, 3, 4, 5, 6]);
    const maskBytes = new Uint8Array([1, 1, 0, 0, 0, 2, 0, 0, 2, 2, 0, 1]);
    await store.appendCubeChunk(token, cubeBytes);
    await store.appendCubeChunk(token, maskBytes);
    const run = store.takeExecutableRun(token);
    expect(run.masks?.header).toEqual({ count: 2, height: 2, width: 3 });
    expect(run.masks?.totalByteLength).toBe(12);
    expect(await collectSegments(run.cube.readSegments())).toEqual(new Uint8Array(cubeBytes));
    expect(await collectSegments(run.masks!.readSegments())).toEqual(maskBytes);
    await store.release(token);
  });

  it("refuses to execute a masked run before the mask bytes arrive", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({
        cube: { bandCount: 1, height: 1, width: 1, wavelengths: null },
        maskCount: 1,
      }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    expect(() => store.takeExecutableRun(token)).toThrow(/did not match/);
    await store.release(token);
  });

  it("describes no mask payload for a mask-free run", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    expect(store.takeExecutableRun(token).masks).toBeNull();
    await store.release(token);
  });

  it("rejects a non-positive or non-integer stack shape", async () => {
    const store = buildStore();
    await expect(
      store.begin(buildBeginRequest({ cube: { bandCount: 0, height: 2, width: 2, wavelengths: null } })),
    ).rejects.toThrow(/invalid stack shape/);
    await expect(
      store.begin(buildBeginRequest({ cube: { bandCount: 1.5, height: 2, width: 2, wavelengths: null } })),
    ).rejects.toThrow(/invalid stack shape/);
  });

  it("throws for an unknown token", async () => {
    const store = buildStore();
    await expect(store.appendCubeChunk("nope", new Uint8Array(4))).rejects.toThrow(
      /Unknown user-script run token/,
    );
  });

  it("serves a spooled cube result in bounded chunks that reassemble exactly", async () => {
    const store = buildStore(8);
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    const run = store.takeExecutableRun(token);
    await writeFile(run.cubeResultSpoolPath, float32BytesOf([1, 2, 3, 4, 5, 6]));
    const summary = store.storeCubeResultForPull(token, [2, 1, 3], 24);
    expect(summary.totalBytes).toBe(24);
    const pulled: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const chunk = await store.readNextResultChunk(token);
      expect(chunk.bytes.byteLength).toBeLessThanOrEqual(8);
      pulled.push(chunk.bytes);
      done = chunk.done;
    }
    expect(reassembleFloats(pulled)).toEqual([1, 2, 3, 4, 5, 6]);
    await store.release(token);
  });

  it("rejects a result byte count that disagrees with the declared shape", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    store.takeExecutableRun(token);
    expect(() => store.storeCubeResultForPull(token, [2, 1, 3], 4)).toThrow(
      /did not match its stack shape/,
    );
    await store.release(token);
  });

  it("throws when reading past the end of the stored result", async () => {
    const store = buildStore(64);
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    const run = store.takeExecutableRun(token);
    await writeFile(run.cubeResultSpoolPath, float32BytesOf([9]));
    store.storeCubeResultForPull(token, [1, 1, 1], 4);
    expect((await store.readNextResultChunk(token)).done).toBe(true);
    await expect(store.readNextResultChunk(token)).rejects.toThrow(/already fully read/);
    await store.release(token);
  });

  it("deletes the result spool file on release", async () => {
    const store = buildStore(64);
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    const run = store.takeExecutableRun(token);
    await writeFile(run.cubeResultSpoolPath, float32BytesOf([7]));
    store.storeCubeResultForPull(token, [1, 1, 1], 4);
    await store.readNextResultChunk(token);
    await store.release(token);
    expect(existsSync(run.cubeResultSpoolPath)).toBe(false);
  });

  // CT-307: input resources are retained across executes and released exactly
  // once, by release() - the execute handler no longer discards them.
  it("releases input resources exactly once, at release, even after executing", async () => {
    let releaseCount = 0;
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({
        cube: { bandCount: 1, height: 1, width: 1, wavelengths: null },
        releaseInputResources: () => {
          releaseCount += 1;
          return Promise.resolve();
        },
      }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    store.takeExecutableRun(token);
    store.markExecutionSettled(token);
    expect(releaseCount).toBe(0);
    await store.release(token);
    await store.release(token);
    expect(releaseCount).toBe(1);
  });

  it("treats release of an unknown token as a no-op", async () => {
    const store = buildStore();
    await expect(store.release("nope")).resolves.toBeUndefined();
  });

  it("invalidates the token after release", async () => {
    const store = buildStore();
    const token = await store.begin(buildBeginRequest());
    await store.release(token);
    await expect(store.appendCubeChunk(token, new Uint8Array(4))).rejects.toThrow(
      /Unknown user-script run token/,
    );
  });

  // CT-268: cancel kills only a registered executing worker; a token without
  // one (never executed, already cleared, unknown) cancels nothing.
  it("cancelExecutingRun invokes the registered worker kill exactly while registered", async () => {
    const store = buildStore();
    const token = await store.begin(buildBeginRequest());
    let killCount = 0;
    store.cancelExecutingRun(token);
    expect(killCount).toBe(0);
    store.registerExecutingWorkerKill(token, () => {
      killCount += 1;
    });
    store.cancelExecutingRun(token);
    expect(killCount).toBe(1);
    store.clearExecutingWorkerKill(token);
    store.cancelExecutingRun(token);
    expect(killCount).toBe(1);
    expect(() => store.cancelExecutingRun("no-such-token")).not.toThrow();
  });
});

// CT-335: a session begun with residentWorker owns ONE resident worker; the
// store spawns it on the first acquire, hands the same instance back while it
// lives, respawns from the retained spool after a kill, and kills it at
// release. The spawn factory is injected, so these tests count spawns with a
// stub instead of a real interpreter.
interface FakeResidentWorker {
  readonly spawnRequest: ResidentPythonWorkerSpawnRequest;
  killCount: number;
  execute: () => never;
  kill: () => void;
  isAlive: () => boolean;
}

function buildFakeResidentWorkerFactory(): {
  spawned: FakeResidentWorker[];
  spawn: (request: ResidentPythonWorkerSpawnRequest) => FakeResidentWorker;
} {
  const spawned: FakeResidentWorker[] = [];
  return {
    spawned,
    spawn: (request) => {
      const worker = buildFakeResidentWorker(request);
      spawned.push(worker);
      return worker;
    },
  };
}

function buildFakeResidentWorker(request: ResidentPythonWorkerSpawnRequest): FakeResidentWorker {
  let alive = true;
  const worker: FakeResidentWorker = {
    spawnRequest: request,
    killCount: 0,
    execute: () => {
      throw new Error("the store never executes; the IPC layer does");
    },
    kill: () => {
      alive = false;
      worker.killCount += 1;
    },
    isAlive: () => alive,
  };
  return worker;
}

describe("resident worker ownership (CT-335)", () => {
  async function beginUploadedResidentSession(
    store: ChunkedUserScriptRunSessionStore,
    residentWorker = true,
  ): Promise<string> {
    const token = await store.begin(
      buildBeginRequest({
        cube: { bandCount: 1, height: 1, width: 1, wavelengths: null },
        input: { kind: "builtin", directory: "builtins", moduleName: "rop" },
        residentWorker,
      }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    return token;
  }

  function acquireForOneSettledExecute(
    store: ChunkedUserScriptRunSessionStore,
    token: string,
  ): FakeResidentWorker {
    store.takeExecutableRun(token);
    const worker = store.acquireResidentWorkerForExecute(token, 1000);
    store.markExecutionSettled(token);
    return worker as unknown as FakeResidentWorker;
  }

  it("spawns exactly one resident worker across three executes", async () => {
    const factory = buildFakeResidentWorkerFactory();
    const store = createChunkedUserScriptRunSessionStore(64, tmpdir(), factory.spawn);
    const token = await beginUploadedResidentSession(store);
    const workers = [1, 2, 3].map(() => acquireForOneSettledExecute(store, token));
    expect(factory.spawned).toHaveLength(1);
    expect(workers[1]).toBe(workers[0]);
    expect(workers[2]).toBe(workers[0]);
    expect(factory.spawned[0]?.spawnRequest.timeoutMs).toBe(1000);
    await store.release(token);
  });

  it("kills the resident worker at release", async () => {
    const factory = buildFakeResidentWorkerFactory();
    const store = createChunkedUserScriptRunSessionStore(64, tmpdir(), factory.spawn);
    const token = await beginUploadedResidentSession(store);
    acquireForOneSettledExecute(store, token);
    await store.release(token);
    expect(factory.spawned[0]?.killCount).toBe(1);
  });

  it("respawns exactly once after a kill between executes", async () => {
    const factory = buildFakeResidentWorkerFactory();
    const store = createChunkedUserScriptRunSessionStore(64, tmpdir(), factory.spawn);
    const token = await beginUploadedResidentSession(store);
    const first = acquireForOneSettledExecute(store, token);
    first.kill();
    const second = acquireForOneSettledExecute(store, token);
    const third = acquireForOneSettledExecute(store, token);
    expect(factory.spawned).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(third).toBe(second);
    await store.release(token);
  });

  it("streams the retained spool into a respawned worker", async () => {
    const factory = buildFakeResidentWorkerFactory();
    const store = createChunkedUserScriptRunSessionStore(64, tmpdir(), factory.spawn);
    const token = await beginUploadedResidentSession(store);
    acquireForOneSettledExecute(store, token).kill();
    acquireForOneSettledExecute(store, token);
    const respawnCube = factory.spawned[1]?.spawnRequest.cube;
    expect(respawnCube?.totalByteLength).toBe(4);
    expect(await collectSegments(respawnCube!.readSegments())).toEqual(new Uint8Array(4));
    await store.release(token);
  });

  it("refuses to acquire a resident worker for a session begun without one", async () => {
    const factory = buildFakeResidentWorkerFactory();
    const store = createChunkedUserScriptRunSessionStore(64, tmpdir(), factory.spawn);
    const token = await beginUploadedResidentSession(store, false);
    store.takeExecutableRun(token);
    expect(() => store.acquireResidentWorkerForExecute(token, 1000)).toThrow(
      /not begun with a resident worker/,
    );
    await store.release(token);
  });
});

function reassembleFloats(chunks: Uint8Array[]): number[] {
  const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Array.from(new Float32Array(combined.buffer));
}
