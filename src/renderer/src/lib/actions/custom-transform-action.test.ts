import { describe, expect, it } from "vitest";

import {
  createCustomTransformSourceTransform,
  CUSTOM_TRANSFORM_ACTION,
  type CubeTransformScriptRunner,
} from "./custom-transform-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";
import {
  buildFormulaCubeTransformState,
  buildImportedToolCubeTransformState,
} from "@/lib/image/band-ops/cube-transform-editing";
import { SCRIPTING_DOCS_HINT } from "@/lib/image/band-ops/user-script-return-contract";
import type { RasterImage } from "@/lib/image/raster-image";

function makeThreeBandUint16Raster(): RasterImage {
  return {
    bandPixels: [Uint16Array.from([100, 101]), Uint16Array.from([800, 801]), Uint16Array.from([1600, 1601])],
    width: 2,
    height: 1,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 16,
    bandLabels: ["One", "Two", "Three"],
    bandWavelengths: [450, 550, 650],
  };
}

function stateWithFormula(expression: string) {
  return { ...DEFAULT_VIEWPORT_RENDERING_STATE, cubeTransform: buildFormulaCubeTransformState(expression) };
}

function runnerReturningCube(bands: Float32Array[]): CubeTransformScriptRunner {
  return async () => ({ status: "completed-cube", shape: [bands.length, 1, 2], bands });
}

async function applyFormulaTransform(
  runner: CubeTransformScriptRunner,
  expression = "cube * 2",
): Promise<RasterImage> {
  const prepared = CUSTOM_TRANSFORM_ACTION.prepareParameterValuesForApply!(
    {},
    stateWithFormula(expression),
    "whole-image",
  );
  const result = (await createCustomTransformSourceTransform(runner)(
    { kind: "raster", raster: makeThreeBandUint16Raster() },
    prepared,
  )) as { raster: RasterImage };
  return result.raster;
}

describe("CUSTOM_TRANSFORM_ACTION", () => {
  it("rejects Apply when neither a formula nor a tool is configured", () => {
    expect(() =>
      CUSTOM_TRANSFORM_ACTION.prepareParameterValuesForApply!({}, DEFAULT_VIEWPORT_RENDERING_STATE, "whole-image"),
    ).toThrow(/needs a formula or an imported tool/i);
  });

  it("runs the configured formula at Apply and builds a float32 stack carrying metadata through", async () => {
    const seenSources: ToolboxRunUserScriptSource[] = [];
    const runner: CubeTransformScriptRunner = async (_raster, source) => {
      seenSources.push(source);
      return {
        status: "completed-cube",
        shape: [3, 1, 2],
        bands: [Float32Array.from([200, 202]), Float32Array.from([1600, 1602]), Float32Array.from([3200, 3202])],
      };
    };
    const raster = await applyFormulaTransform(runner);
    expect(seenSources).toEqual([{ mode: "formula", expression: "cube * 2" }]);
    expect(raster.bandCount).toBe(3);
    expect(raster.sampleFormat).toBe("float");
    expect(Array.from(raster.bandPixels[0]!)).toEqual([200, 202]);
    expect(raster.bandLabels).toEqual(["One", "Two", "Three"]);
    expect(raster.bandWavelengths).toEqual([450, 550, 650]);
  });

  it("runs a configured tool by its remembered file path", async () => {
    const seenSources: ToolboxRunUserScriptSource[] = [];
    const runner: CubeTransformScriptRunner = async (_raster, source) => {
      seenSources.push(source);
      return { status: "completed-cube", shape: [1, 1, 2], bands: [Float32Array.from([0, 0])] };
    };
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      cubeTransform: buildImportedToolCubeTransformState("C:/tools/transform-tool.py", "transform-tool.py"),
    };
    const prepared = CUSTOM_TRANSFORM_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    await createCustomTransformSourceTransform(runner)(
      { kind: "raster", raster: makeThreeBandUint16Raster() },
      prepared,
    );
    expect(seenSources).toEqual([{ mode: "import", scriptPath: "C:/tools/transform-tool.py" }]);
    expect(CUSTOM_TRANSFORM_ACTION.formatAppliedLabel!(prepared)).toBe(
      "Custom script (transform-tool.py)",
    );
  });

  it("accepts a changed band count and drops labels and wavelengths for the generic identity", async () => {
    const raster = await applyFormulaTransform(
      runnerReturningCube([Float32Array.from([700, 700]), Float32Array.from([800, 800])]),
      "np.diff(cube, axis=0)",
    );
    expect(raster.bandCount).toBe(2);
    expect(raster.bandLabels).toBeUndefined();
    expect(raster.bandWavelengths).toBeUndefined();
  });

  it("accepts a returned cube with different spatial dimensions (e.g. a crop)", async () => {
    const runner: CubeTransformScriptRunner = async () => ({
      status: "completed-cube",
      shape: [1, 1, 1],
      bands: [Float32Array.from([999])],
    });
    const raster = await applyFormulaTransform(runner);
    expect(raster.height).toBe(1);
    expect(raster.width).toBe(1);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([999]);
  });

  it("surfaces a failed run with the docs hint and leaves no output", async () => {
    const runner: CubeTransformScriptRunner = async () => ({
      status: "failed",
      message: "The script failed: boom",
    });
    await expect(applyFormulaTransform(runner)).rejects.toThrow(SCRIPTING_DOCS_HINT);
  });

  it("records the formula expression in the applied label", () => {
    const prepared = CUSTOM_TRANSFORM_ACTION.prepareParameterValuesForApply!(
      {},
      stateWithFormula("np.diff(cube, axis=0)"),
      "whole-image",
    );
    expect(CUSTOM_TRANSFORM_ACTION.formatAppliedLabel!(prepared)).toBe(
      "Custom script (np.diff(cube, axis=0))",
    );
  });

  it("resets band-dependent viewer state in the output panel and keeps no config there", () => {
    const state = { ...stateWithFormula("cube * 2"), selectedBandIndex: 2 };
    const next = CUSTOM_TRANSFORM_ACTION.apply(state, {});
    expect(next.selectedBandIndex).toBe(0);
    expect(next.cubeTransform).toBeNull();
  });
});
