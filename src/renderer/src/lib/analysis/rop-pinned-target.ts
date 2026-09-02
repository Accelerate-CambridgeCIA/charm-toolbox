import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-315: the ROP aside PINS to the panel it was opened on. The CT-105
// result-panel auto-select would otherwise retarget the aside the moment a
// press delivers a candidate panel, releasing the retained run session and
// resetting every candidate. The pin is derived here and nowhere else: it
// follows selection only until it first lands on a raster panel, then it holds
// that panel until the panel loses its raster or the aside closes.

export interface RopPinnedPanel {
  readonly viewportIndex: number;
  readonly viewportNumber: number;
  readonly raster: RasterImage;
}

export interface RopPinSelection {
  readonly viewportIndex: number;
  readonly viewportNumber: number;
}

export type RopPinPanelsByIndex = ReadonlyMap<number, { readonly source: ViewportImageSource }>;

// Returns the PREVIOUS pin object whenever nothing changed, so a caller can
// store the result in state without looping on identity alone.
export function resolveNextRopPin(
  previous: RopPinnedPanel | null,
  selection: RopPinSelection | null,
  panels: RopPinPanelsByIndex,
): RopPinnedPanel | null {
  if (previous === null) return pinToSelectedRasterPanelOrNull(selection, panels);
  const raster = findRasterAtPanelIndexOrNull(previous.viewportIndex, panels);
  if (raster === null) return null;
  return raster === previous.raster ? previous : { ...previous, raster };
}

// The pinned panel lost its raster: it was closed, or replaced by a photo that
// has no cube to project. Either way the aside has nothing left to project.
export function hasPinnedRopPanelLostItsRaster(
  previous: RopPinnedPanel | null,
  panels: RopPinPanelsByIndex,
): boolean {
  return previous !== null && findRasterAtPanelIndexOrNull(previous.viewportIndex, panels) === null;
}

function pinToSelectedRasterPanelOrNull(
  selection: RopPinSelection | null,
  panels: RopPinPanelsByIndex,
): RopPinnedPanel | null {
  if (selection === null) return null;
  const raster = findRasterAtPanelIndexOrNull(selection.viewportIndex, panels);
  if (raster === null) return null;
  return { viewportIndex: selection.viewportIndex, viewportNumber: selection.viewportNumber, raster };
}

function findRasterAtPanelIndexOrNull(
  viewportIndex: number,
  panels: RopPinPanelsByIndex,
): RasterImage | null {
  const content = panels.get(viewportIndex);
  if (!content || content.source.kind !== "raster") return null;
  return content.source.raster;
}

// CT-333: "Use selected panel" is the one explicit way to MOVE the pin. Unlike
// resolveNextRopPin, which only follows selection until it first lands, this
// re-pins on demand: the button press is the deliberate act, so no confirmation
// stands between it and the new source. Re-pinning to the panel already pinned
// returns the previous object, so the aside never resets on a no-op press.
export function repinRopToSelection(
  previous: RopPinnedPanel | null,
  selection: RopPinSelection | null,
  panels: RopPinPanelsByIndex,
): RopPinnedPanel | null {
  if (selection === null) return null;
  if (previous !== null && previous.viewportIndex === selection.viewportIndex) return previous;
  return pinToSelectedRasterPanelOrNull(selection, panels);
}
