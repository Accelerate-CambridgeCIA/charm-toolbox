import { describe, expect, it } from "vitest";

import {
  describeUserScriptRunTransferFailure,
  openUserScriptRunSessionOverCube,
  runUserScriptOverCubeInChunks,
  type UserScriptRunChunkedApi,
  type UserScriptRunCubeInput,
} from "./run-user-script-chunked";

interface FakeApiRecord {
  begins: ToolboxUserScriptRunBeginRequest[];
  uploadedChunks: Uint8Array[];
  executedTokens: string[];
  executes: ToolboxUserScriptRunExecuteRequest[];
  releasedTokens: string[];
  canceledTokens: string[];
  emitProgress: (event: ToolboxUserScriptRunProgressEvent) => void;
  progressListenerCount: () => number;
}

interface FakeApiBehavior {
  begin?: ToolboxUserScriptRunBeginResult;
  execute?: ToolboxUserScriptRunExecuteResult;
  resultChunks?: ToolboxUserScriptRunResultChunkResult[];
  failUploadWith?: Error;
}

function buildFakeApi(behavior: FakeApiBehavior = {}): { api: UserScriptRunChunkedApi; record: FakeApiRecord } {
  const progressListeners = new Set<(event: ToolboxUserScriptRunProgressEvent) => void>();
  const record: FakeApiRecord = {
    begins: [],
    uploadedChunks: [],
    executedTokens: [],
    executes: [],
    releasedTokens: [],
    canceledTokens: [],
    emitProgress: (event) => progressListeners.forEach((listener) => listener(event)),
    progressListenerCount: () => progressListeners.size,
  };
  const resultChunks = [...(behavior.resultChunks ?? [])];
  const api: UserScriptRunChunkedApi = {
    beginUserScriptRun: (request) => {
      record.begins.push(request);
      return Promise.resolve(behavior.begin ?? { status: "ready", token: "tok", sourceName: null });
    },
    sendUserScriptRunCubeChunk: (request) => {
      if (behavior.failUploadWith) return Promise.reject(behavior.failUploadWith);
      record.uploadedChunks.push(request.bytes);
      return Promise.resolve();
    },
    executeUserScriptRun: (request) => {
      record.executedTokens.push(request.token);
      record.executes.push(request);
      return Promise.resolve(behavior.execute ?? { status: "completed", value: [1, 2] });
    },
    onUserScriptRunProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    readUserScriptRunResultChunk: () => {
      const next = resultChunks.shift();
      if (!next) return Promise.reject(new Error("no more result chunks"));
      return Promise.resolve(next);
    },
    releaseUserScriptRun: (request) => {
      record.releasedTokens.push(request.token);
      return Promise.resolve();
    },
    cancelUserScriptRun: (request) => {
      record.canceledTokens.push(request.token);
      return Promise.resolve();
    },
  };
  return { api, record };
}

function buildCubeInput(bands: number[][], width: number): UserScriptRunCubeInput {
  return {
    bandCount: bands.length,
    height: bands[0]!.length / width,
    width,
    wavelengths: null,
    getBandAsFloat32: (index) => Float32Array.from(bands[index]!),
  };
}

const FORMULA: ToolboxRunUserScriptSource = { mode: "formula", expression: "cube.mean()" };

describe("runUserScriptOverCubeInChunks", () => {
  it("uploads every band's bytes in chunk-size pieces and completes a value run", async () => {
    const { api, record } = buildFakeApi();
    const cube = buildCubeInput([[1, 2, 3], [4, 5, 6]], 3);
    const result = await runUserScriptOverCubeInChunks(api, cube, FORMULA, "value", {}, 8);
    expect(result).toEqual({ status: "completed", value: [1, 2] });
    expect(record.begins[0]?.cube).toEqual({ bandCount: 2, height: 1, width: 3, wavelengths: null });
    expect(record.uploadedChunks.map((chunk) => chunk.byteLength)).toEqual([8, 4, 8, 4]);
    expect(reassembleFloats(record.uploadedChunks)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(record.executedTokens).toEqual(["tok"]);
    expect(record.releasedTokens).toEqual(["tok"]);
  });

  it("attaches the begin result's sourceName to a completed run", async () => {
    const { api } = buildFakeApi({ begin: { status: "ready", token: "tok", sourceName: "tool.py" } });
    const result = await runUserScriptOverCubeInChunks(api, buildCubeInput([[1]], 1), { mode: "import" }, "value");
    expect(result).toEqual({ status: "completed", value: [1, 2], sourceName: "tool.py" });
  });

  it("pulls and reassembles a cube result", async () => {
    const resultBytes = new Uint8Array(Float32Array.from([9, 8, 7, 6]).buffer);
    const { api } = buildFakeApi({
      execute: { status: "completed-cube", shape: [2, 1, 2], totalBytes: 16 },
      resultChunks: [
        { done: false, bytes: resultBytes.slice(0, 10) },
        { done: true, bytes: resultBytes.slice(10) },
      ],
    });
    const result = await runUserScriptOverCubeInChunks(api, buildCubeInput([[1]], 1), FORMULA, "cube");
    if (result.status !== "completed-cube") throw new Error(`unexpected ${result.status}`);
    expect(result.shape).toEqual([2, 1, 2]);
    expect(result.bands.map((band) => Array.from(band))).toEqual([[9, 8], [7, 6]]);
  });

  it("returns a canceled begin without uploading or executing", async () => {
    const { api, record } = buildFakeApi({ begin: { status: "canceled" } });
    const result = await runUserScriptOverCubeInChunks(api, buildCubeInput([[1]], 1), { mode: "import" }, "value");
    expect(result).toEqual({ status: "canceled" });
    expect(record.uploadedChunks).toHaveLength(0);
    expect(record.executedTokens).toHaveLength(0);
    expect(record.releasedTokens).toHaveLength(0);
  });

  it("passes a failed begin through unchanged", async () => {
    const { api } = buildFakeApi({ begin: { status: "failed", message: "no interpreter" } });
    const result = await runUserScriptOverCubeInChunks(api, buildCubeInput([[1]], 1), FORMULA, "value");
    expect(result).toEqual({ status: "failed", message: "no interpreter" });
  });

  it("maps a transfer error to a failed result and still releases the run", async () => {
    const { api, record } = buildFakeApi({ failUploadWith: new Error("chunk rejected") });
    const result = await runUserScriptOverCubeInChunks(api, buildCubeInput([[1]], 1), FORMULA, "value");
    expect(result).toEqual({ status: "failed", message: "chunk rejected" });
    expect(record.releasedTokens).toEqual(["tok"]);
  });

  it("reports run readiness and a monotonic upload fraction ending in null", async () => {
    const { api } = buildFakeApi();
    const readiness: string[] = [];
    const fractions: Array<number | null> = [];
    await runUserScriptOverCubeInChunks(
      api,
      buildCubeInput([[1, 2], [3, 4]], 2),
      FORMULA,
      "value",
      {
        onRunReady: () => readiness.push("ready"),
        onUploadProgress: (fraction) => fractions.push(fraction),
      },
      8,
    );
    expect(readiness).toEqual(["ready"]);
    expect(fractions).toEqual([0, 0.5, 1, null]);
  });

  it("rejects a band whose length does not match the described shape", async () => {
    const { api } = buildFakeApi();
    const cube: UserScriptRunCubeInput = {
      bandCount: 1,
      height: 2,
      width: 2,
      wavelengths: null,
      getBandAsFloat32: () => Float32Array.from([1, 2]),
    };
    const result = await runUserScriptOverCubeInChunks(api, cube, FORMULA, "value");
    expect(result.status).toBe("failed");
  });

  // CT-307: masks ride the same chunk channel after the cube bytes, and the
  // begin request declares their count.
  it("declares the mask count at begin and uploads mask bytes after the cube bytes", async () => {
    const { api, record } = buildFakeApi();
    const cube = buildCubeInput([[1, 2, 3, 4]], 2);
    const masks = [Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([0, 0, 2, 2])];
    await runUserScriptOverCubeInChunks(api, cube, FORMULA, "value", {}, 1024, { masks });
    expect(record.begins[0]?.masks).toEqual({ count: 2 });
    expect(record.uploadedChunks.map((chunk) => chunk.byteLength)).toEqual([16, 4, 4]);
    expect(Array.from(record.uploadedChunks[1]!)).toEqual([1, 1, 0, 0]);
    expect(Array.from(record.uploadedChunks[2]!)).toEqual([0, 0, 2, 2]);
  });

  it("fails a run whose mask does not match the stack's spatial size", async () => {
    const { api } = buildFakeApi();
    const result = await runUserScriptOverCubeInChunks(
      api,
      buildCubeInput([[1, 2, 3, 4]], 2),
      FORMULA,
      "value",
      {},
      1024,
      { masks: [Uint8Array.from([1, 0])] },
    );
    expect(result).toEqual({
      status: "failed",
      message: "A mask did not match the described stack shape.",
    });
  });

  it("passes per-execute params through to the execute request", async () => {
    const { api, record } = buildFakeApi();
    await runUserScriptOverCubeInChunks(api, buildCubeInput([[1]], 1), FORMULA, "value", {}, 1024, {
      params: { seed: 42, bins: 255 },
    });
    expect(record.executes[0]).toEqual({ token: "tok", params: { seed: 42, bins: 255 } });
  });

  it("omits params from the execute request when none are given", async () => {
    const { api, record } = buildFakeApi();
    await runUserScriptOverCubeInChunks(api, buildCubeInput([[1]], 1), FORMULA, "value");
    expect(record.executes[0]).toEqual({ token: "tok" });
  });

  // CT-307: in-script progress for THIS run's token reaches onWorkerProgress;
  // other tokens are filtered out and the listener is removed afterwards.
  it("routes this run's worker progress to onWorkerProgress and unsubscribes after execute", async () => {
    const { api, record } = buildFakeApi();
    const wrapped: UserScriptRunChunkedApi = {
      ...api,
      executeUserScriptRun: (request) => {
        record.emitProgress({ token: "tok", fraction: 0.5 });
        record.emitProgress({ token: "other-run", fraction: 0.9 });
        return api.executeUserScriptRun(request);
      },
    };
    const fractions: number[] = [];
    await runUserScriptOverCubeInChunks(wrapped, buildCubeInput([[1]], 1), FORMULA, "value", {
      onWorkerProgress: (fraction) => fractions.push(fraction),
    });
    expect(fractions).toEqual([0.5]);
    expect(record.progressListenerCount()).toBe(0);
  });
});

// CT-335: a retained session exists to execute many times, so its begin asks
// main for a resident worker; a one-shot begin must stay byte-identical to
// what it sent before, so the flag is ABSENT there, not false.
describe("resident worker begin flag (CT-335)", () => {
  it("asks for a resident worker when opening a retained session", async () => {
    const { api, record } = buildFakeApi();
    const opened = await openUserScriptRunSessionOverCube(api, buildCubeInput([[1]], 1), FORMULA, "value");
    expect(record.begins[0]?.residentWorker).toBe(true);
    if (opened.status === "open") await opened.session.release();
  });

  it("sends a one-shot begin without any residentWorker property", async () => {
    const { api, record } = buildFakeApi();
    await runUserScriptOverCubeInChunks(api, buildCubeInput([[1]], 1), FORMULA, "value");
    expect(record.begins[0]).not.toHaveProperty("residentWorker");
  });
});

describe("describeUserScriptRunTransferFailure", () => {
  it("strips the electron invoke prefix from a wrapped handler rejection", () => {
    const wrapped = new Error(
      "Error invoking remote method 'user-script:run-cube-chunk': Error: The uploaded stack bytes did not match the described stack shape.",
    );
    expect(describeUserScriptRunTransferFailure(wrapped)).toBe(
      "The uploaded stack bytes did not match the described stack shape.",
    );
  });

  it("returns a plain message unchanged", () => {
    expect(describeUserScriptRunTransferFailure(new Error("plain"))).toBe("plain");
    expect(describeUserScriptRunTransferFailure("text")).toBe("text");
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
