import { describe, expect, it } from "vitest";

import { OperationStoppedError } from "@/lib/image/operation-stop";
import type { RasterImage } from "@/lib/image/raster-image";
import { addCategoryToLayer, createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import type { UserScriptRunChunkedApi } from "@/lib/python/run-user-script-chunked";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

import { computeNpcScoreShowingPanelBusy } from "./run-npc-analysis";

function buildSilentBusyRegistrar(): BusyEntryRegistrar {
  const handle: BusyEntryHandle = { id: "busy-1", update: () => {}, clear: () => {} };
  return { registerAppBusyEntry: () => handle, registerViewportBusyEntry: () => handle };
}

function buildTwoPixelStack(): RasterImage {
  return {
    bandPixels: [Uint16Array.from([5, 6])],
    width: 2,
    height: 1,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

function buildTwoCategoryLayer(): MaskLayer {
  const layer = addCategoryToLayer(createMaskLayer("mask-1", "Parchment mask", 2, 1));
  return { ...layer, values: Uint8Array.from([1, 2]) };
}

interface RecordedRun {
  begin: ToolboxUserScriptRunBeginRequest | null;
  chunks: Uint8Array[];
  executeParams: unknown;
  released: boolean;
}

function buildRecordingApi(
  executed: ToolboxUserScriptRunExecuteResult,
  recorded: RecordedRun,
): UserScriptRunChunkedApi {
  return {
    beginUserScriptRun: (request) => {
      recorded.begin = request;
      return Promise.resolve({ status: "ready", token: "tok", sourceName: null });
    },
    sendUserScriptRunCubeChunk: (request) => {
      recorded.chunks.push(request.bytes);
      return Promise.resolve();
    },
    executeUserScriptRun: (request) => {
      recorded.executeParams = request.params;
      return Promise.resolve(executed);
    },
    readUserScriptRunResultChunk: () => Promise.reject(new Error("unused")),
    releaseUserScriptRun: () => {
      recorded.released = true;
      return Promise.resolve();
    },
    cancelUserScriptRun: () => Promise.resolve(),
  };
}

function buildRecordedRun(): RecordedRun {
  return { begin: null, chunks: [], executeParams: undefined, released: false };
}

function runNpcAgainst(
  api: UserScriptRunChunkedApi,
  bins = 255,
): ReturnType<typeof computeNpcScoreShowingPanelBusy> {
  return computeNpcScoreShowingPanelBusy(
    { raster: buildTwoPixelStack(), maskLayer: buildTwoCategoryLayer(), bins },
    { busyRegistrar: buildSilentBusyRegistrar(), viewportIndex: 0 },
    api,
  );
}

describe("computeNpcScoreShowingPanelBusy", () => {
  it("runs the packaged npc script with the category masks and the bins parameter", async () => {
    const recorded = buildRecordedRun();
    const api = buildRecordingApi({ status: "completed", value: [0.75] }, recorded);
    const outcome = await runNpcAgainst(api, 64);
    expect(outcome).toEqual({ status: "computed", scores: [0.75] });
    expect(recorded.begin?.source).toEqual({ mode: "builtin", scriptName: "npc" });
    expect(recorded.begin?.masks).toEqual({ count: 2 });
    expect(recorded.executeParams).toEqual({ bins: 64 });
    expect(recorded.released).toBe(true);
  });

  it("uploads the two category masks after the cube bytes", async () => {
    const recorded = buildRecordedRun();
    await runNpcAgainst(buildRecordingApi({ status: "completed", value: [1] }, recorded));
    expect(recorded.chunks).toHaveLength(3);
    expect(Array.from(recorded.chunks[1] ?? [])).toEqual([1, 0]);
    expect(Array.from(recorded.chunks[2] ?? [])).toEqual([0, 1]);
  });

  it("reports a script failure as a failure carrying the worker's message", async () => {
    const recorded = buildRecordedRun();
    const api = buildRecordingApi({ status: "failed", message: "bins must be at least 2" }, recorded);
    expect(await runNpcAgainst(api)).toEqual({
      status: "failed",
      message: "bins must be at least 2",
    });
  });

  it("refuses a result that is not a list of scores", async () => {
    const recorded = buildRecordedRun();
    const api = buildRecordingApi({ status: "completed", value: 0.75 }, recorded);
    const outcome = await runNpcAgainst(api);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.message).toMatch(/must be an array/);
  });

  it("refuses a score list whose length is not the stack's band count", async () => {
    const recorded = buildRecordedRun();
    const api = buildRecordingApi({ status: "completed", value: [0.5, 0.6] }, recorded);
    const outcome = await runNpcAgainst(api);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.message).toContain("one Potential Contrast score per band (expected 1, got 2)");
    }
  });

  it("refuses a score list holding a non-finite entry", async () => {
    const recorded = buildRecordedRun();
    const api = buildRecordingApi({ status: "completed", value: [Number.NaN] }, recorded);
    const outcome = await runNpcAgainst(api);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.message).toContain("Potential Contrast score 1 must be a finite number");
    }
  });

  it("reports a user stop as stopped rather than as a failure", async () => {
    const api: UserScriptRunChunkedApi = {
      beginUserScriptRun: () => Promise.reject(new OperationStoppedError()),
      sendUserScriptRunCubeChunk: () => Promise.resolve(),
      executeUserScriptRun: () => Promise.reject(new Error("unused")),
      readUserScriptRunResultChunk: () => Promise.reject(new Error("unused")),
      releaseUserScriptRun: () => Promise.resolve(),
      cancelUserScriptRun: () => Promise.resolve(),
    };
    expect(await runNpcAgainst(api)).toEqual({ status: "stopped" });
  });
});
