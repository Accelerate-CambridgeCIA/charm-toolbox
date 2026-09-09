import { describe, expect, it } from "vitest";

import {
  hasPinnedRopPanelLostItsRaster,
  repinRopToSelection,
  resolveNextRopPin,
  type RopPinnedPanel,
  type RopPinPanelsByIndex,
} from "./rop-pinned-target";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

function makeRaster(firstSample: number): RasterImage {
  return {
    bandPixels: [Float32Array.from([firstSample])],
    width: 1,
    height: 1,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: 1,
  };
}

function panelsHoldingRasters(entries: ReadonlyArray<[number, RasterImage]>): RopPinPanelsByIndex {
  return new Map(
    entries.map(([index, raster]): [number, { source: ViewportImageSource }] => [
      index,
      { source: { kind: "raster", raster } },
    ]),
  );
}

const PANEL_ONE = { viewportIndex: 0, viewportNumber: 1 };
const PANEL_TWO = { viewportIndex: 1, viewportNumber: 2 };

describe("resolveNextRopPin", () => {
  it("stays unpinned while no single raster panel is selected", () => {
    const panels = panelsHoldingRasters([[0, makeRaster(1)]]);
    expect(resolveNextRopPin(null, null, panels)).toBeNull();
  });

  it("refuses to pin to a selected panel that holds no raster", () => {
    const panels: RopPinPanelsByIndex = new Map([
      [0, { source: { kind: "pixels", pixels: new Uint8Array(4), width: 1, height: 1 } }],
    ]);
    expect(resolveNextRopPin(null, PANEL_ONE, panels)).toBeNull();
  });

  it("pins to the first single raster panel selected", () => {
    const raster = makeRaster(1);
    const pin = resolveNextRopPin(null, PANEL_ONE, panelsHoldingRasters([[0, raster]]));
    expect(pin).toEqual({ viewportIndex: 0, viewportNumber: 1, raster });
  });

  it("keeps the pin, object identity included, when the selection moves elsewhere", () => {
    const panels = panelsHoldingRasters([
      [0, makeRaster(1)],
      [1, makeRaster(2)],
    ]);
    const pinned = resolveNextRopPin(null, PANEL_ONE, panels) as RopPinnedPanel;
    expect(resolveNextRopPin(pinned, PANEL_TWO, panels)).toBe(pinned);
    expect(resolveNextRopPin(pinned, null, panels)).toBe(pinned);
  });

  it("re-derives the raster when the pinned panel's raster identity changes", () => {
    const replaced = makeRaster(9);
    const pinned: RopPinnedPanel = { ...PANEL_ONE, raster: makeRaster(1) };
    const next = resolveNextRopPin(pinned, PANEL_TWO, panelsHoldingRasters([[0, replaced]]));
    expect(next).toEqual({ ...PANEL_ONE, raster: replaced });
  });

  it("clears the pin when the pinned panel no longer holds a raster", () => {
    const pinned: RopPinnedPanel = { ...PANEL_ONE, raster: makeRaster(1) };
    const panels = panelsHoldingRasters([[1, makeRaster(2)]]);
    expect(resolveNextRopPin(pinned, PANEL_TWO, panels)).toBeNull();
  });
});

describe("hasPinnedRopPanelLostItsRaster", () => {
  it("reports no loss while unpinned or while the pinned panel still holds its raster", () => {
    const panels = panelsHoldingRasters([[0, makeRaster(1)]]);
    const pinned: RopPinnedPanel = { ...PANEL_ONE, raster: makeRaster(1) };
    expect(hasPinnedRopPanelLostItsRaster(null, panels)).toBe(false);
    expect(hasPinnedRopPanelLostItsRaster(pinned, panels)).toBe(false);
  });

  it("reports the loss when the pinned panel was closed", () => {
    const pinned: RopPinnedPanel = { ...PANEL_ONE, raster: makeRaster(1) };
    expect(hasPinnedRopPanelLostItsRaster(pinned, new Map())).toBe(true);
  });
});

describe("repinRopToSelection", () => {
  it("re-pins to another selected raster panel", () => {
    const replacement = makeRaster(2);
    const pinned: RopPinnedPanel = { ...PANEL_ONE, raster: makeRaster(1) };
    const panels = panelsHoldingRasters([
      [0, pinned.raster],
      [1, replacement],
    ]);
    expect(repinRopToSelection(pinned, PANEL_TWO, panels)).toEqual({
      ...PANEL_TWO,
      raster: replacement,
    });
  });

  it("refuses to re-pin to a selected panel that holds a photo", () => {
    const pinned: RopPinnedPanel = { ...PANEL_ONE, raster: makeRaster(1) };
    const panels: RopPinPanelsByIndex = new Map([
      [0, { source: { kind: "raster", raster: pinned.raster } }],
      [1, { source: { kind: "pixels", pixels: new Uint8Array(4), width: 1, height: 1 } }],
    ]);
    expect(repinRopToSelection(pinned, PANEL_TWO, panels)).toBeNull();
  });

  it("returns the previous pin, object identity included, when the pinned panel is selected", () => {
    const pinned: RopPinnedPanel = { ...PANEL_ONE, raster: makeRaster(1) };
    const panels = panelsHoldingRasters([[0, makeRaster(9)]]);
    expect(repinRopToSelection(pinned, PANEL_ONE, panels)).toBe(pinned);
  });

  it("re-pins to nothing while no single panel is selected", () => {
    const pinned: RopPinnedPanel = { ...PANEL_ONE, raster: makeRaster(1) };
    expect(repinRopToSelection(pinned, null, panelsHoldingRasters([[0, pinned.raster]]))).toBeNull();
  });
});
