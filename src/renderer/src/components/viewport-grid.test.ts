import { describe, expect, it, vi } from "vitest";

import {
  buildMaskOverlayOrNull,
  buildMaskPaintingOrNull,
  type MaskOverlayInputs,
  type MaskPaintingInputs,
} from "@/components/viewport-grid";
import { createMaskLayer } from "@/lib/masks/mask-layer";
import { DEFAULT_MASK_BRUSH_SETTINGS } from "@/lib/masks/mask-brush";
import type { ViewportCellContent } from "@/components/viewport-grid";

function buildCoveringContent(): ViewportCellContent {
  return {
    fileName: "fixture.tif",
    source: {
      kind: "raster",
      raster: {
        bandPixels: [new Uint16Array(16)],
        width: 4,
        height: 4,
        bitsPerSample: 16,
        sampleFormat: "uint",
        bandCount: 1,
      },
    },
  };
}

function buildOverlayInputs(overrides: Partial<MaskOverlayInputs> = {}): MaskOverlayInputs {
  return {
    isOverlayVisible: true,
    layer: createMaskLayer("mask-1", "Layer 1", 4, 4),
    content: buildCoveringContent(),
    ...overrides,
  };
}

function buildInputs(overrides: Partial<MaskPaintingInputs> = {}): MaskPaintingInputs {
  const layer = createMaskLayer("mask-1", "Layer 1", 4, 4);
  const content = buildCoveringContent();
  return {
    isSelected: true,
    isMasksToolActive: true,
    layer,
    brush: DEFAULT_MASK_BRUSH_SETTINGS,
    content,
    onCommitStrokeValues: vi.fn(),
    ...overrides,
  };
}

describe("buildMaskPaintingOrNull", () => {
  it("returns null when the panel is not selected, even with a covering layer and the tool active", () => {
    expect(buildMaskPaintingOrNull(buildInputs({ isSelected: false }))).toBeNull();
  });

  it("returns non-null when the panel is selected, the tool is active, and the layer covers the stack", () => {
    const result = buildMaskPaintingOrNull(buildInputs({ isSelected: true }));
    expect(result).not.toBeNull();
  });

  it("still returns null when the Masks tool is off, regardless of selection", () => {
    expect(
      buildMaskPaintingOrNull(buildInputs({ isSelected: true, isMasksToolActive: false })),
    ).toBeNull();
  });
});

// CT-342: the overlay answers to the panel's visibility flag alone. An
// UNSELECTED panel showing a mask is the whole point of the flag, so that is
// the case asserted first.
describe("buildMaskOverlayOrNull", () => {
  it("returns the layer for an unselected panel while the flag is on", () => {
    const overlay = buildMaskOverlayOrNull(buildOverlayInputs());
    expect(overlay?.layer.id).toBe("mask-1");
  });

  it("returns null once the flag is off", () => {
    expect(buildMaskOverlayOrNull(buildOverlayInputs({ isOverlayVisible: false }))).toBeNull();
  });

  it("returns null when no layer is selected", () => {
    expect(buildMaskOverlayOrNull(buildOverlayInputs({ layer: null }))).toBeNull();
  });

  it("returns null when the selected layer no longer covers the stack", () => {
    const layer = createMaskLayer("mask-1", "Layer 1", 8, 8);
    expect(buildMaskOverlayOrNull(buildOverlayInputs({ layer }))).toBeNull();
  });

  it("returns null for an empty panel", () => {
    expect(buildMaskOverlayOrNull(buildOverlayInputs({ content: null }))).toBeNull();
  });
});
