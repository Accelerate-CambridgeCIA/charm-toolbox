import { describe, expect, it, vi } from "vitest";

import { buildMaskPaintingOrNull, type MaskPaintingInputs } from "@/components/viewport-grid";
import { createMaskLayer } from "@/lib/masks/mask-layer";
import { DEFAULT_MASK_BRUSH_SETTINGS } from "@/lib/masks/mask-brush";
import type { ViewportCellContent } from "@/components/viewport-grid";

function buildInputs(overrides: Partial<MaskPaintingInputs> = {}): MaskPaintingInputs {
  const layer = createMaskLayer("mask-1", "Layer 1", 4, 4);
  const content: ViewportCellContent = {
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
