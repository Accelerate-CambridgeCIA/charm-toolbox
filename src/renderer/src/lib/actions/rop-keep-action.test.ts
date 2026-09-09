import { describe, expect, it } from "vitest";

import {
  buildRopCandidateDeliveryAction,
  buildRopDeliveryParameterValues,
  buildRopKeepAction,
  ROP_KEEP_ACTION_ID,
} from "./rop-keep-action";

const SOURCE = { kind: "image-bitmap", bitmap: {} } as unknown as Parameters<
  NonNullable<ReturnType<typeof buildRopKeepAction>["transformSource"]>
>[0];

describe("buildRopKeepAction", () => {
  it("builds a one-band float32 stack from the candidate values, ignoring the source", () => {
    const action = buildRopKeepAction({
      seed: 7,
      bands: [Float32Array.from([1, 2, 3, 4])],
      width: 2,
      height: 2,
      score: null,
      objectiveLabel: null,
    });
    const result = action.transformSource?.(SOURCE, {});
    expect(result?.kind).toBe("raster");
    if (result?.kind !== "raster") return;
    expect(result.raster).toMatchObject({ width: 2, height: 2, bandCount: 1, sampleFormat: "float" });
    expect(Array.from(result.raster.bandPixels[0] ?? [])).toEqual([1, 2, 3, 4]);
  });

  it("copies the candidate values so the kept stack never shares the panel's buffer", () => {
    const values = Float32Array.from([1, 2]);
    const action = buildRopKeepAction({
      seed: 7,
      bands: [values],
      width: 2,
      height: 1,
      score: null,
      objectiveLabel: null,
    });
    const result = action.transformSource?.(SOURCE, {});
    if (result?.kind !== "raster") throw new Error("expected a raster result");
    expect(result.raster.bandPixels[0]?.buffer).not.toBe(values.buffer);
  });

  it("records the seed (and the objective score when present) in the History label", () => {
    const unscored = buildRopKeepAction({
      seed: 20260822,
      bands: [Float32Array.from([0])],
      width: 1,
      height: 1,
      score: null,
      objectiveLabel: null,
    });
    const scored = buildRopKeepAction({
      seed: 20260822,
      bands: [Float32Array.from([0])],
      width: 1,
      height: 1,
      score: 0.25,
      objectiveLabel: "CNR",
    });
    expect(unscored.appliedLabel).toBe("ROP (seed 20260822)");
    expect(scored.appliedLabel).toBe("ROP (seed 20260822, CNR: 0.2500)");
    expect(scored.id).toBe(ROP_KEEP_ACTION_ID);
    expect(scored.label).toBe("ROP");
  });

  it("toasts 'Projection kept'", () => {
    const action = buildRopKeepAction({
      seed: 1,
      bands: [Float32Array.from([0])],
      width: 1,
      height: 1,
      score: null,
      objectiveLabel: null,
    });
    expect(action.successMessage).toBe("Projection kept");
  });

  it("leaves the rendering state untouched on apply", () => {
    const action = buildRopKeepAction({
      seed: 1,
      bands: [Float32Array.from([0])],
      width: 1,
      height: 1,
      score: null,
      objectiveLabel: null,
    });
    const state = { marker: true } as unknown as Parameters<typeof action.apply>[0];
    expect(action.apply(state, {})).toBe(state);
  });
});

// CT-316: a press delivers through the same action shape, so the candidate
// panel gets the same id, label, History wording and one-band float copy; only
// the toast differs, and the placed raster is handed back for identity tracking.
describe("buildRopCandidateDeliveryAction", () => {
  const request = {
    seed: 20260822,
    bands: [Float32Array.from([5, 6])],
    width: 2,
    height: 1,
    score: 0.25,
    objectiveLabel: "CNR",
  };

  it("places exactly the raster it hands back, copied from the candidate values", () => {
    const delivery = buildRopCandidateDeliveryAction(request);
    const result = delivery.action.transformSource?.(SOURCE, {});
    if (result?.kind !== "raster") throw new Error("expected a raster result");
    expect(result.raster).toBe(delivery.raster);
    expect(delivery.raster).toMatchObject({ width: 2, height: 1, bandCount: 1, sampleFormat: "float" });
    expect(Array.from(delivery.raster.bandPixels[0] ?? [])).toEqual([5, 6]);
    expect(delivery.raster.bandPixels[0]?.buffer).not.toBe(request.bands[0]?.buffer);
  });

  it("toasts 'Projection ready' and otherwise matches the keep action", () => {
    const delivery = buildRopCandidateDeliveryAction(request);
    const kept = buildRopKeepAction(request);
    expect(delivery.action.successMessage).toBe("Projection ready");
    expect(delivery.action.id).toBe(kept.id);
    expect(delivery.action.label).toBe(kept.label);
    expect(delivery.action.icon).toBe(kept.icon);
    expect(delivery.action.appliedLabel).toBe("ROP (seed 20260822, CNR: 0.2500)");
  });
});

// CT-337: a press that drew several projections delivers ONE stack with a band
// per projection; a single projection keeps the plain band naming it had.
describe("a batch delivery (CT-337)", () => {
  const batchRequest = {
    seed: 20260822,
    bands: [Float32Array.from([1, 2]), Float32Array.from([3, 4]), Float32Array.from([5, 6])],
    width: 2,
    height: 1,
    score: null,
    objectiveLabel: null,
    projectionCount: 3,
  };

  it("places one band per projection, named after its draw", () => {
    const delivery = buildRopCandidateDeliveryAction(batchRequest);
    expect(delivery.raster.bandCount).toBe(3);
    expect(delivery.raster.bandLabels).toEqual(["Projection 1", "Projection 2", "Projection 3"]);
    expect(Array.from(delivery.raster.bandPixels[2] ?? [])).toEqual([5, 6]);
  });

  it("records how many projections the stack holds in its History label", () => {
    expect(buildRopKeepAction(batchRequest).appliedLabel).toBe(
      "ROP (seed 20260822, 3 projections)",
    );
  });

  it("leaves a one-projection delivery without band labels", () => {
    const delivery = buildRopCandidateDeliveryAction({ ...batchRequest, bands: [Float32Array.from([1, 2])], projectionCount: 1 });
    expect(delivery.raster.bandLabels).toBeUndefined();
  });

  it("names the projection a kept best band came from", () => {
    const action = buildRopKeepAction({
      ...batchRequest,
      bands: [Float32Array.from([3, 4])],
      score: 1.5,
      objectiveLabel: "CNR",
      projectionIndex: 2,
    });
    expect(action.appliedLabel).toBe("ROP (seed 20260822, projection 2 of 3, CNR: 1.500)");
  });
});

// CT-337: the memory preflight prices every band the delivery places.
describe("buildRopDeliveryParameterValues", () => {
  it("states the number of bands the stack will hold", () => {
    expect(
      buildRopDeliveryParameterValues({
        seed: 1,
        bands: [Float32Array.from([0]), Float32Array.from([0])],
        width: 1,
        height: 1,
        score: null,
        objectiveLabel: null,
      }),
    ).toEqual({ ropProjectionBandCount: 2 });
  });
});
