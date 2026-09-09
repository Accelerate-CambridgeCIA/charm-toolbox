// CT-309: seeds and params for the built-in rop.py runs. Every "New
// projection" press draws a FRESH seed (so presses explore the projection
// space) and passes it through params, which is what makes a kept stack's
// History entry reproducible. The MSI_E2E bridge can force a fixed seed so a
// spec's press matches the reference output pinned in the fixture manifest;
// the bridge only exists under --msi-e2e-test-mode, never in production.

export const ROP_SEED_EXCLUSIVE_UPPER_BOUND = 2 ** 32;

export function drawRopSeed(
  forcedSeed: number | null,
  drawRandomUnitInterval: () => number = Math.random,
): number {
  if (forcedSeed !== null) return forcedSeed;
  return Math.floor(drawRandomUnitInterval() * ROP_SEED_EXCLUSIVE_UPPER_BOUND);
}

// CT-337: one press can draw several projections. rop.py already returns
// params["count"] bands, so the whole batch costs one round trip.
export const MIN_ROP_PROJECTIONS_PER_PRESS = 1;
export const MAX_ROP_PROJECTIONS_PER_PRESS = 20;
export const DEFAULT_ROP_PROJECTIONS_PER_PRESS = 1;

export const ROP_PROJECTIONS_PER_PRESS_HINT =
  `Enter a whole number from ${MIN_ROP_PROJECTIONS_PER_PRESS} to ${MAX_ROP_PROJECTIONS_PER_PRESS}.`;

// Mirrors parseRopSearchProjectionCountOrNull: the field keeps the text as
// typed, and null means "not a usable count yet", which blocks the press.
export function parseRopProjectionsPerPressOrNull(countText: string): number | null {
  const trimmed = countText.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (parsed < MIN_ROP_PROJECTIONS_PER_PRESS) return null;
  return parsed <= MAX_ROP_PROJECTIONS_PER_PRESS ? parsed : null;
}

export function buildRopExecuteParams(
  seed: number,
  projectionCount: number,
): Record<string, unknown> {
  return { seed, count: projectionCount };
}

interface WindowCarryingRopSeedOverride {
  readonly toolboxE2E?: { readonly readRopForcedSeedOverride?: () => unknown };
}

// The bridge exposes a READER (CT-316) because a spec may change the forced
// seed between presses; a snapshot taken at launch could not follow it.
export function readForcedRopSeedFromE2eBridgeOrNull(
  windowLike: unknown = globalThis.window,
): number | null {
  const override = (windowLike as WindowCarryingRopSeedOverride)?.toolboxE2E
    ?.readRopForcedSeedOverride?.();
  return typeof override === "number" && Number.isSafeInteger(override) ? override : null;
}
