import { afterEach, describe, expect, it } from "vitest";

import {
  CONCATENATE_STACKS_ACTION,
  CONCATENATE_STACKS_SECOND_STACK_PARAMETER_ID,
} from "./concatenate-stacks-action";
import { CUSTOM_TRANSFORM_ACTION } from "./custom-transform-action";
import { DENOISE_ACTION } from "./denoise-action";
import {
  estimateApplyAllocationBytesForAction,
  estimateSourceCloneBytes,
  sumRasterBandBytes,
} from "./estimate-apply-allocation";
import { ICA_ACTION } from "./ica-action";
import { L2_MINIMIZATION_ACTION } from "./l2-minimization-action";
import {
  describeFastIcaFitSampling,
  MAX_FAST_ICA_FIT_SAMPLES,
} from "@/lib/image/dimension-reduction/ica";
import { MNF_ACTION } from "./mnf-action";
import { PCA_ACTION } from "./pca-action";
import { PERCENTILE_CLIP_ACTION } from "./percentile-clip-action";
import {
  BIT_SHIFT_ACTION,
  CLIP_BY_VALUE_ACTION,
  CROP_TO_REGION_ACTION,
  FALSE_COLOR_ACTION,
  FLAT_FIELD_ACTION,
  INVERT_ACTION,
  NORMALIZE_DATA_ACTION,
  REFLECT_ACTION,
  ROTATE_ACTION,
  SPECTRALON_ACTION,
  STANDARDIZE_ACTION,
  TONE_CURVE_ACTION,
} from "./registered-actions";
import { buildRopDeliveryParameterValues, buildRopKeepAction } from "./rop-keep-action";
import { SPATIAL_FILTER_ACTION } from "./spatial-filter-action";
import { SPECTRAL_DERIVATIVE_ACTION } from "./spectral-derivative-action";
import { THRESHOLD_ACTION } from "./threshold-action";
import { TONE_CURVE_SCOPE_PARAMETER_ID, WHOLE_STACK_TONE_CURVE_SCOPE_VALUE } from "./tone-curve-scope";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  forgetAllReferenceRasters,
  rememberReferenceRaster,
} from "@/lib/image/reference-raster-store";
import { buildLoadedPanelReferenceToken } from "@/lib/image/reference-token";
import type { ViewportImageSource } from "@/lib/webgl/texture";

const WIDTH = 4;
const HEIGHT = 3;
const BAND_COUNT = 5;
const PIXELS = WIDTH * HEIGHT;
const UINT16_CUBE_BYTES = PIXELS * BAND_COUNT * 2;
const FLOAT32_CUBE_BYTES = PIXELS * BAND_COUNT * 4;

function uint16Source(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: Array.from({ length: BAND_COUNT }, () => new Uint16Array(PIXELS)),
    width: WIDTH,
    height: HEIGHT,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: BAND_COUNT,
  };
  return { kind: "raster", raster };
}

describe("estimateApplyAllocationBytesForAction", () => {
  it("bills the float operations a full float32 cube regardless of scope", () => {
    for (const action of [
      STANDARDIZE_ACTION,
      PERCENTILE_CLIP_ACTION,
      DENOISE_ACTION,
      SPATIAL_FILTER_ACTION,
      SPECTRAL_DERIVATIVE_ACTION,
      FLAT_FIELD_ACTION,
      SPECTRALON_ACTION,
    ]) {
      expect(estimateApplyAllocationBytesForAction(action, uint16Source(), {}), action.id).toBe(
        FLOAT32_CUBE_BYTES,
      );
    }
  });

  it("bills the custom transform a source-band-count float32 cube (its output band count is only known after the Python runs)", () => {
    expect(estimateApplyAllocationBytesForAction(CUSTOM_TRANSFORM_ACTION, uint16Source(), {})).toBe(
      FLOAT32_CUBE_BYTES,
    );
  });

  it("bills normalize a full float32 cube (min-max only since CT-281)", () => {
    expect(estimateApplyAllocationBytesForAction(NORMALIZE_DATA_ACTION, uint16Source(), {})).toBe(
      FLOAT32_CUBE_BYTES,
    );
  });

  it("bills the type-preserving whole-cube operations the source's own bytes", () => {
    for (const action of [BIT_SHIFT_ACTION, ROTATE_ACTION, REFLECT_ACTION, CLIP_BY_VALUE_ACTION]) {
      expect(estimateApplyAllocationBytesForAction(action, uint16Source(), {}), action.id).toBe(
        UINT16_CUBE_BYTES,
      );
    }
  });

  it("bills the tone curve one band unless the whole-stack scope is chosen", () => {
    expect(estimateApplyAllocationBytesForAction(TONE_CURVE_ACTION, uint16Source(), {})).toBe(PIXELS * 2);
    expect(
      estimateApplyAllocationBytesForAction(TONE_CURVE_ACTION, uint16Source(), {
        [TONE_CURVE_SCOPE_PARAMETER_ID]: WHOLE_STACK_TONE_CURVE_SCOPE_VALUE,
      }),
    ).toBe(UINT16_CUBE_BYTES);
  });

  it("bills invert one band unless it applies to all bands", () => {
    expect(estimateApplyAllocationBytesForAction(INVERT_ACTION, uint16Source(), {})).toBe(PIXELS * 2);
    expect(
      estimateApplyAllocationBytesForAction(INVERT_ACTION, uint16Source(), { applyToAllBands: true }),
    ).toBe(UINT16_CUBE_BYTES);
  });

  it("bills threshold one uint8 byte per sample", () => {
    expect(estimateApplyAllocationBytesForAction(THRESHOLD_ACTION, uint16Source(), {})).toBe(
      PIXELS * BAND_COUNT,
    );
  });

  it("bills crop by the committed rectangle and falls back to the whole cube without one", () => {
    const withRegion = estimateApplyAllocationBytesForAction(CROP_TO_REGION_ACTION, uint16Source(), {
      imagePixelX0: 1,
      imagePixelY0: 0,
      imagePixelX1: 2,
      imagePixelY1: 1,
    });
    expect(withRegion).toBe(2 * 2 * BAND_COUNT * 2);
    expect(estimateApplyAllocationBytesForAction(CROP_TO_REGION_ACTION, uint16Source(), {})).toBe(
      UINT16_CUBE_BYTES,
    );
  });

  // CT-240: dimension reduction outputs keptCount float32 component bands; ICA
  // additionally holds a float32 whitened axis per kept component through its
  // fit, so it is billed double. An absent component count resolves to the
  // default min(10, bandCount) exactly like the apply itself.
  it("bills PCA and MNF keptCount float32 bands from the component-count parameter", () => {
    for (const action of [PCA_ACTION, MNF_ACTION]) {
      expect(
        estimateApplyAllocationBytesForAction(action, uint16Source(), { componentCount: 3 }),
        action.id,
      ).toBe(3 * PIXELS * 4);
      expect(estimateApplyAllocationBytesForAction(action, uint16Source(), {}), action.id).toBe(
        BAND_COUNT * PIXELS * 4,
      );
    }
  });

  it("bills ICA the component stack plus its float32 whitened working set (full below the cap)", () => {
    expect(estimateApplyAllocationBytesForAction(ICA_ACTION, uint16Source(), { componentCount: 3 })).toBe(
      2 * 3 * PIXELS * 4,
    );
  });

  it("caps ICA's whitened working set at the FastICA sample cap for reference-scale rasters", () => {
    const raster: RasterImage = {
      bandPixels: [new Uint16Array(1)],
      width: 10_000,
      height: 5_000,
      bitsPerSample: 16,
      sampleFormat: "uint",
      bandCount: 100,
    };
    const source: ViewportImageSource = { kind: "raster", raster };
    const { sampledCount } = describeFastIcaFitSampling(10_000 * 5_000);
    expect(sampledCount).toBeLessThanOrEqual(MAX_FAST_ICA_FIT_SAMPLES);
    expect(estimateApplyAllocationBytesForAction(ICA_ACTION, source, { componentCount: 10 })).toBe(
      10 * 10_000 * 5_000 * 4 + 10 * sampledCount * 4,
    );
  });

  it("defaults unlisted actions to one float band and non-raster sources to zero", () => {
    expect(estimateApplyAllocationBytesForAction(FALSE_COLOR_ACTION, uint16Source(), {})).toBe(PIXELS * 4);
    const browserSource = { kind: "html-image", image: {} } as unknown as ViewportImageSource;
    expect(estimateApplyAllocationBytesForAction(FALSE_COLOR_ACTION, browserSource, {})).toBe(0);
  });

  it("bills a kept ROP projection exactly one float band at source dimensions (CT-309)", () => {
    const keepAction = buildRopKeepAction({
      seed: 1,
      bands: [new Float32Array(PIXELS)],
      width: WIDTH,
      height: HEIGHT,
      score: null,
      objectiveLabel: null,
    });
    expect(estimateApplyAllocationBytesForAction(keepAction, uint16Source(), {})).toBe(PIXELS * 4);
  });

  // CT-337: a press can deliver a whole batch, and the delivery states how many
  // bands it places so the preflight prices all of them.
  it("bills a delivered ROP batch one float band per projection (CT-337)", () => {
    const request = {
      seed: 1,
      bands: [new Float32Array(PIXELS), new Float32Array(PIXELS), new Float32Array(PIXELS)],
      width: WIDTH,
      height: HEIGHT,
      score: null,
      objectiveLabel: null,
    };
    const action = buildRopKeepAction(request);
    const values = buildRopDeliveryParameterValues(request);
    expect(estimateApplyAllocationBytesForAction(action, uint16Source(), values)).toBe(
      PIXELS * 4 * 3,
    );
  });

  it("bills L2 minimization exactly one float band at source dimensions (CT-313)", () => {
    expect(estimateApplyAllocationBytesForAction(L2_MINIMIZATION_ACTION, uint16Source(), {})).toBe(
      PIXELS * 4,
    );
  });

  describe("CONCATENATE_STACKS_ACTION (CT-300)", () => {
    afterEach(() => {
      forgetAllReferenceRasters();
    });

    it("falls back to the active stack's own bytes before a second stack is chosen", () => {
      expect(estimateApplyAllocationBytesForAction(CONCATENATE_STACKS_ACTION, uint16Source(), {})).toBe(
        UINT16_CUBE_BYTES,
      );
    });

    it("bills pixelCount x total band count x the widened type's byte width once a second stack resolves", () => {
      const token = buildLoadedPanelReferenceToken(2, "ir.tif");
      const secondRaster: RasterImage = {
        bandPixels: [new Uint8Array(PIXELS)],
        width: WIDTH,
        height: HEIGHT,
        bitsPerSample: 8,
        sampleFormat: "uint",
        bandCount: 1,
      };
      rememberReferenceRaster(token, secondRaster);
      const bytes = estimateApplyAllocationBytesForAction(CONCATENATE_STACKS_ACTION, uint16Source(), {
        [CONCATENATE_STACKS_SECOND_STACK_PARAMETER_ID]: token,
      });
      // uint8 + uint16 widens to uint16 (2 bytes); total bands = 5 + 1.
      expect(bytes).toBe(PIXELS * (BAND_COUNT + 1) * 2);
    });
  });
});

describe("estimateSourceCloneBytes", () => {
  it("bills a raster clone every band's bytes and non-raster sources zero", () => {
    const source = uint16Source();
    expect(estimateSourceCloneBytes(source)).toBe(UINT16_CUBE_BYTES);
    expect(sumRasterBandBytes((source as { raster: RasterImage } & typeof source).raster)).toBe(
      UINT16_CUBE_BYTES,
    );
    const browserSource = { kind: "html-image", image: {} } as unknown as ViewportImageSource;
    expect(estimateSourceCloneBytes(browserSource)).toBe(0);
  });
});
