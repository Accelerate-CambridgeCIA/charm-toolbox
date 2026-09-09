import { describe, expect, it } from "vitest";

import {
  buildRopExecuteParams,
  drawRopSeed,
  parseRopProjectionsPerPressOrNull,
  readForcedRopSeedFromE2eBridgeOrNull,
  MAX_ROP_PROJECTIONS_PER_PRESS,
  ROP_SEED_EXCLUSIVE_UPPER_BOUND,
} from "./rop-run-request";

describe("drawRopSeed", () => {
  it("returns the forced seed when one is set", () => {
    expect(drawRopSeed(20260822, () => 0.5)).toBe(20260822);
    expect(drawRopSeed(0, () => 0.5)).toBe(0);
  });

  it("draws a whole seed below 2^32 otherwise", () => {
    expect(drawRopSeed(null, () => 0)).toBe(0);
    expect(drawRopSeed(null, () => 0.5)).toBe(ROP_SEED_EXCLUSIVE_UPPER_BOUND / 2);
    expect(drawRopSeed(null, () => 0.999999999)).toBeLessThan(ROP_SEED_EXCLUSIVE_UPPER_BOUND);
    expect(Number.isInteger(drawRopSeed(null, () => 0.123456789))).toBe(true);
  });
});

describe("buildRopExecuteParams", () => {
  it("passes the seed and a single-candidate count", () => {
    expect(buildRopExecuteParams(7, 1)).toEqual({ seed: 7, count: 1 });
  });

  // CT-337: rop.py returns params["count"] bands, so a batch press is one run.
  it("passes the number of projections the press should draw", () => {
    expect(buildRopExecuteParams(7, 3)).toEqual({ seed: 7, count: 3 });
  });
});

describe("parseRopProjectionsPerPressOrNull", () => {
  it("accepts a whole number inside the locked range", () => {
    expect(parseRopProjectionsPerPressOrNull("1")).toBe(1);
    expect(parseRopProjectionsPerPressOrNull(" 3 ")).toBe(3);
    expect(parseRopProjectionsPerPressOrNull(String(MAX_ROP_PROJECTIONS_PER_PRESS))).toBe(
      MAX_ROP_PROJECTIONS_PER_PRESS,
    );
  });

  it("refuses zero, an over-range count, and anything that is not a whole number", () => {
    expect(parseRopProjectionsPerPressOrNull("0")).toBeNull();
    expect(parseRopProjectionsPerPressOrNull(String(MAX_ROP_PROJECTIONS_PER_PRESS + 1))).toBeNull();
    expect(parseRopProjectionsPerPressOrNull("2.5")).toBeNull();
    expect(parseRopProjectionsPerPressOrNull("-3")).toBeNull();
    expect(parseRopProjectionsPerPressOrNull("")).toBeNull();
    expect(parseRopProjectionsPerPressOrNull("three")).toBeNull();
  });
});

describe("readForcedRopSeedFromE2eBridgeOrNull", () => {
  it("reads a whole seed from the e2e bridge's reader", () => {
    expect(
      readForcedRopSeedFromE2eBridgeOrNull({
        toolboxE2E: { readRopForcedSeedOverride: () => 42 },
      }),
    ).toBe(42);
  });

  it("follows the reader when the seed changes between presses (CT-316)", () => {
    let seed: number | null = 1;
    const windowLike = { toolboxE2E: { readRopForcedSeedOverride: () => seed } };
    expect(readForcedRopSeedFromE2eBridgeOrNull(windowLike)).toBe(1);
    seed = 2;
    expect(readForcedRopSeedFromE2eBridgeOrNull(windowLike)).toBe(2);
  });

  it("returns null without the bridge, without the override, or for junk", () => {
    expect(readForcedRopSeedFromE2eBridgeOrNull(undefined)).toBeNull();
    expect(readForcedRopSeedFromE2eBridgeOrNull({})).toBeNull();
    expect(readForcedRopSeedFromE2eBridgeOrNull({ toolboxE2E: {} })).toBeNull();
    expect(
      readForcedRopSeedFromE2eBridgeOrNull({
        toolboxE2E: { readRopForcedSeedOverride: () => null },
      }),
    ).toBeNull();
    expect(
      readForcedRopSeedFromE2eBridgeOrNull({
        toolboxE2E: { readRopForcedSeedOverride: () => 1.5 },
      }),
    ).toBeNull();
  });
});
