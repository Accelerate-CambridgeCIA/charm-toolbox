import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import type { UserScriptRunChunkedApi } from "@/lib/python/run-user-script-chunked";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

import type { RopSearchRunRequest } from "./rop-search-request";
import {
  createRopProjectionSessionHolder,
  scoreRopCandidateShowingPanelBusy,
  type RopScoreRequest,
} from "./run-rop-analysis";

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
  const layer = createMaskLayer("mask-1", "Labels", 2, 1);
  return { ...layer, values: Uint8Array.from([1, 2]) };
}

interface RecordedSessionRuns {
  beginRequests: ToolboxUserScriptRunBeginRequest[];
  cubeChunkCount: number;
  executeParams: unknown[];
  executeModuleNames: (string | undefined)[];
  releasedCount: number;
}

function buildCubeServingApi(
  candidateValues: number[],
  recorded: RecordedSessionRuns,
): UserScriptRunChunkedApi {
  const resultBytes = new Uint8Array(Float32Array.from(candidateValues).buffer.slice(0));
  return {
    beginUserScriptRun: (request) => {
      recorded.beginRequests.push(request);
      return Promise.resolve({ status: "ready", token: "tok", sourceName: null });
    },
    sendUserScriptRunCubeChunk: () => {
      recorded.cubeChunkCount += 1;
      return Promise.resolve();
    },
    executeUserScriptRun: (request) => {
      recorded.executeParams.push(request.params);
      recorded.executeModuleNames.push(request.builtinModuleName);
      return Promise.resolve({
        status: "completed-cube",
        shape: [1, 1, candidateValues.length] as [number, number, number],
        totalBytes: resultBytes.byteLength,
      });
    },
    readUserScriptRunResultChunk: () =>
      Promise.resolve({ done: true, bytes: resultBytes.slice() }),
    releaseUserScriptRun: () => {
      recorded.releasedCount += 1;
      return Promise.resolve();
    },
    cancelUserScriptRun: () => Promise.resolve(),
  };
}

function buildRecordedSessionRuns(): RecordedSessionRuns {
  return {
    beginRequests: [],
    cubeChunkCount: 0,
    executeParams: [],
    executeModuleNames: [],
    releasedCount: 0,
  };
}

// CT-337: a batch press asks for N projections and the worker answers with an
// N-band cube in one execute.
function buildBatchServingApi(
  bands: ReadonlyArray<ReadonlyArray<number>>,
  recorded: RecordedSessionRuns,
): UserScriptRunChunkedApi {
  const bytes = new Uint8Array(Float32Array.from(bands.flat()).buffer.slice(0));
  const api = buildCubeServingApi([], recorded);
  api.executeUserScriptRun = (request) => {
    recorded.executeParams.push(request.params);
    return Promise.resolve({
      status: "completed-cube",
      shape: [bands.length, 1, bands[0]?.length ?? 0] as [number, number, number],
      totalBytes: bytes.byteLength,
    });
  };
  api.readUserScriptRunResultChunk = () => Promise.resolve({ done: true, bytes: bytes.slice() });
  return api;
}

function rollBindings() {
  return { busyRegistrar: buildSilentBusyRegistrar(), viewportIndex: 0 };
}

describe("createRopProjectionSessionHolder", () => {
  it("uploads the cube once and re-executes against the retained session per press", async () => {
    const recorded = buildRecordedSessionRuns();
    const holder = createRopProjectionSessionHolder(
      buildTwoPixelStack(),
      [],
      buildCubeServingApi([10, 20], recorded),
    );
    const first = await holder.executeProjectionShowingPanelBusy(11, 1, rollBindings());
    const uploadedChunksAfterFirstPress = recorded.cubeChunkCount;
    const second = await holder.executeProjectionShowingPanelBusy(22, 1, rollBindings());

    expect(first).toEqual({ status: "rolled", bands: [Float32Array.from([10, 20])] });
    expect(second.status).toBe("rolled");
    expect(recorded.beginRequests).toHaveLength(1);
    expect(recorded.beginRequests[0]?.source).toEqual({ mode: "builtin", scriptName: "rop" });
    expect(recorded.cubeChunkCount).toBe(uploadedChunksAfterFirstPress);
    expect(recorded.executeParams).toEqual([
      { seed: 11, count: 1 },
      { seed: 22, count: 1 },
    ]);
    expect(recorded.releasedCount).toBe(0);
  });

  it("draws several projections in one execute and returns every band (CT-337)", async () => {
    const recorded = buildRecordedSessionRuns();
    const holder = createRopProjectionSessionHolder(
      buildTwoPixelStack(),
      [],
      buildBatchServingApi([[10, 20], [30, 40], [50, 60]], recorded),
    );
    const outcome = await holder.executeProjectionShowingPanelBusy(11, 3, rollBindings());

    expect(recorded.executeParams).toEqual([{ seed: 11, count: 3 }]);
    expect(outcome.status).toBe("rolled");
    if (outcome.status !== "rolled") return;
    expect(outcome.bands.map((band) => Array.from(band))).toEqual([
      [10, 20],
      [30, 40],
      [50, 60],
    ]);
  });

  it("releases the retained session exactly once", async () => {
    const recorded = buildRecordedSessionRuns();
    const holder = createRopProjectionSessionHolder(
      buildTwoPixelStack(),
      [],
      buildCubeServingApi([10, 20], recorded),
    );
    await holder.executeProjectionShowingPanelBusy(11, 1, rollBindings());
    await holder.release();
    await holder.release();
    expect(recorded.releasedCount).toBe(1);
  });

  it("maps a failed execute onto a failed outcome", async () => {
    const recorded = buildRecordedSessionRuns();
    const api = buildCubeServingApi([10, 20], recorded);
    api.executeUserScriptRun = () =>
      Promise.resolve({ status: "failed", message: "boom" });
    const holder = createRopProjectionSessionHolder(buildTwoPixelStack(), [], api);
    const outcome = await holder.executeProjectionShowingPanelBusy(11, 1, rollBindings());
    expect(outcome).toEqual({ status: "failed", message: "boom" });
  });

  it("reports a script that returned a value instead of a stack as a failure", async () => {
    const recorded = buildRecordedSessionRuns();
    const api = buildCubeServingApi([10, 20], recorded);
    api.executeUserScriptRun = () => Promise.resolve({ status: "completed", value: 3 });
    const holder = createRopProjectionSessionHolder(buildTwoPixelStack(), [], api);
    const outcome = await holder.executeProjectionShowingPanelBusy(11, 1, rollBindings());
    expect(outcome.status).toBe("failed");
  });
});

function buildSearchRequest(): RopSearchRunRequest {
  return {
    seed: 42,
    projectionCount: 50,
    objectiveKind: "cnr",
    maskLayer: buildTwoCategoryLayer(),
    npcBinCount: 255,
    cnrTextCategoryValue: 1,
    cnrBackgroundCategoryValue: 2,
    customObjectiveSource: null,
  };
}

// CT-336: the search runs rop_search in the SAME retained session the press
// uses, so it uploads the cube once (shared with the press) and names the
// rop_search module on the execute frame instead of opening a new session.
describe("createRopProjectionSessionHolder search", () => {
  it("presses then searches on ONE session, naming rop_search on the search execute", async () => {
    const recorded = buildRecordedSessionRuns();
    const masks = [Uint8Array.from([1, 0]), Uint8Array.from([0, 1])];
    const holder = createRopProjectionSessionHolder(
      buildTwoPixelStack(),
      masks,
      buildCubeServingApi([7, 9], recorded),
    );
    await holder.executeProjectionShowingPanelBusy(11, 1, rollBindings());
    const uploadsAfterPress = recorded.cubeChunkCount;
    const outcome = await holder.searchBestProjectionShowingPanelBusy(buildSearchRequest(), rollBindings());

    expect(outcome).toEqual({ status: "searched", values: Float32Array.from([7, 9]) });
    expect(recorded.beginRequests).toHaveLength(1);
    expect(recorded.beginRequests[0]?.masks).toEqual({ count: 2 });
    expect(recorded.cubeChunkCount).toBe(uploadsAfterPress);
    expect(recorded.executeModuleNames).toEqual([undefined, "rop_search"]);
    expect(recorded.executeParams[1]).toMatchObject({
      seed: 42,
      count: 50,
      objective: "cnr",
      text_mask_index: 0,
      background_mask_index: 1,
    });
    expect(recorded.releasedCount).toBe(0);
  });

  it("opens the session with the objective masks when the search runs first", async () => {
    const recorded = buildRecordedSessionRuns();
    const masks = [Uint8Array.from([1, 0]), Uint8Array.from([0, 1])];
    const holder = createRopProjectionSessionHolder(
      buildTwoPixelStack(),
      masks,
      buildCubeServingApi([3, 4], recorded),
    );
    const outcome = await holder.searchBestProjectionShowingPanelBusy(buildSearchRequest(), rollBindings());

    expect(outcome.status).toBe("searched");
    expect(recorded.beginRequests[0]?.source).toEqual({ mode: "builtin", scriptName: "rop" });
    expect(recorded.beginRequests[0]?.masks).toEqual({ count: 2 });
    expect(recorded.executeModuleNames).toEqual(["rop_search"]);
  });

  it("maps a failed search execute onto a failed outcome", async () => {
    const recorded = buildRecordedSessionRuns();
    const api = buildCubeServingApi([1, 2], recorded);
    api.executeUserScriptRun = () =>
      Promise.resolve({ status: "failed", message: "No projection produced a finite score." });
    const holder = createRopProjectionSessionHolder(buildTwoPixelStack(), [], api);
    const outcome = await holder.searchBestProjectionShowingPanelBusy(buildSearchRequest(), rollBindings());
    expect(outcome).toEqual({
      status: "failed",
      message: "No projection produced a finite score.",
    });
  });
});

function buildScoreRequest(overrides: Partial<RopScoreRequest>): RopScoreRequest {
  return {
    candidateValues: Float32Array.from([10, 20]),
    width: 2,
    height: 1,
    objectiveKind: "cnr",
    maskLayer: buildTwoCategoryLayer(),
    cnrTextCategoryValue: 1,
    cnrBackgroundCategoryValue: 2,
    customScript: null,
    ...overrides,
  };
}

describe("scoreRopCandidateShowingPanelBusy", () => {
  it("computes CNR in TS without any worker run", async () => {
    // Text pixel 10, background pixel 20 with std 0: numpy gives -Inf, which
    // is reported as a failure; use two background pixels for a finite pin.
    // CT-322: CNR is the absolute mean difference over the background spread.
    const request = buildScoreRequest({
      candidateValues: Float32Array.from([10, 20, 30]),
      width: 3,
      maskLayer: { ...buildTwoCategoryLayer(), width: 3, values: Uint8Array.from([1, 2, 2]) },
    });
    const outcome = await scoreRopCandidateShowingPanelBusy(request, rollBindings());
    expect(outcome.status).toBe("scored");
    if (outcome.status === "scored") expect(outcome.score).toBeCloseTo(Math.abs((10 - 25) / 5), 10);
  });

  it("fails a CNR score that is not finite instead of retaining it", async () => {
    const request = buildScoreRequest({
      candidateValues: Float32Array.from([10, 20]),
      maskLayer: { ...buildTwoCategoryLayer(), values: Uint8Array.from([1, 2]) },
    });
    const outcome = await scoreRopCandidateShowingPanelBusy(request, rollBindings());
    expect(outcome.status).toBe("failed");
  });

  // CT-318: npc.py returns one score per band and the candidate is a single
  // band, so the objective is the first (only) element of that list.
  it("scores the NPC objective with the first band of the built-in script's score list", async () => {
    const recorded = buildRecordedSessionRuns();
    const api = buildCubeServingApi([0], recorded);
    api.executeUserScriptRun = () => Promise.resolve({ status: "completed", value: [0.75] });
    const outcome = await scoreRopCandidateShowingPanelBusy(
      buildScoreRequest({ objectiveKind: "npc" }),
      rollBindings(),
      api,
    );
    expect(outcome).toEqual({ status: "scored", score: 0.75 });
    expect(recorded.beginRequests[0]?.source).toEqual({ mode: "builtin", scriptName: "npc" });
    expect(recorded.beginRequests[0]?.masks).toEqual({ count: 2 });
  });

  it("fails the NPC objective when the script returns a bare number instead of a list", async () => {
    const recorded = buildRecordedSessionRuns();
    const api = buildCubeServingApi([0], recorded);
    api.executeUserScriptRun = () => Promise.resolve({ status: "completed", value: 0.75 });
    const outcome = await scoreRopCandidateShowingPanelBusy(
      buildScoreRequest({ objectiveKind: "npc" }),
      rollBindings(),
      api,
    );
    expect(outcome.status).toBe("failed");
  });

  it("runs a custom objective script with the candidate as the cube and the masks in params", async () => {
    const recorded = buildRecordedSessionRuns();
    const api = buildCubeServingApi([0], recorded);
    api.executeUserScriptRun = () => Promise.resolve({ status: "completed", value: 12.5 });
    const outcome = await scoreRopCandidateShowingPanelBusy(
      buildScoreRequest({
        objectiveKind: "custom",
        customScript: { filePath: "C:/objective.py", fileName: "objective.py", source: "" },
      }),
      rollBindings(),
      api,
    );
    expect(outcome).toEqual({ status: "scored", score: 12.5 });
    expect(recorded.beginRequests[0]?.source).toEqual({
      mode: "import",
      scriptPath: "C:/objective.py",
    });
    expect(recorded.beginRequests[0]?.masks).toEqual({ count: 2 });
    expect(recorded.beginRequests[0]?.cube).toMatchObject({ bandCount: 1, height: 1, width: 2 });
  });

  it("fails a custom objective that returns a non-finite or non-numeric value, with the docs hint", async () => {
    const recorded = buildRecordedSessionRuns();
    const api = buildCubeServingApi([0], recorded);
    api.executeUserScriptRun = () => Promise.resolve({ status: "completed", value: "not a number" });
    const outcome = await scoreRopCandidateShowingPanelBusy(
      buildScoreRequest({
        objectiveKind: "custom",
        customScript: { filePath: "C:/objective.py", fileName: "objective.py", source: "" },
      }),
      rollBindings(),
      api,
    );
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.message).toContain("one finite number");
      expect(outcome.message).toContain("How to write a custom script");
    }
  });
});
