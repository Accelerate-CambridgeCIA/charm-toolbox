import { Wand2 } from "lucide-react";

import {
  validateTransformedCubeAgainstSource,
  buildTransformOutputBandMetadata,
  type TransformedCubeResult,
  type TransformSourceBandMetadata,
} from "@/lib/image/band-ops/cube-transform-contract";
import {
  describeCubeTransformForAudit,
  describeCubeTransformRunError,
  type CubeTransformEditingState,
} from "@/lib/image/band-ops/cube-transform-editing";
import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";
import { throwIfOperationStopped } from "@/lib/image/operation-stop";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import type { RasterImage } from "@/lib/image/raster-image";
import { runUserScriptOverRasterAtApply } from "@/lib/python/run-user-script-at-apply";

import type { ParameterValuesById } from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import {
  clearCubeTransformEditingState,
  EMPTY_REMOVED_BAND_INDEXES,
  type TransformProgressCallback,
  type ViewportActionAsyncSourceTransform,
  type ViewportRenderingState,
} from "./viewport-action";

// The Custom transform runs the user's Python AT APPLY TIME, unlike band
// weighting and band selection (which still run at Run formula / Import script
// time): the editor only CONFIGURES the input - a formula expression or a
// picked .py/.zip file path - and Apply uploads the cube, runs the worker,
// validates the returned cube against the source, and builds a NEW float32
// stack whose band count is free (metadata carries through only when the band
// count is unchanged). A failed run leaves the source panel and the configured
// input untouched, so the user can correct the script and Apply again; the
// script file is re-read from disk on every Apply for the same reason.

export const CUSTOM_TRANSFORM_ACTION_ID = "custom-transform";
const CUSTOM_TRANSFORM_MODE_PARAMETER_ID = "customTransformMode";
const CUSTOM_TRANSFORM_EXPRESSION_PARAMETER_ID = "customTransformExpression";
const CUSTOM_TRANSFORM_SCRIPT_PATH_PARAMETER_ID = "customTransformScriptPath";
const CUSTOM_TRANSFORM_DESCRIPTION_PARAMETER_ID = "customTransformDescription";

const NO_TRANSFORM_CONFIGURED_MESSAGE =
  "Custom script needs a formula or an imported tool. Enter one first.";

export type CubeTransformScriptRunner = (
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  onProgress?: TransformProgressCallback,
  abortSignal?: AbortSignal,
) => Promise<ToolboxRunUserScriptResult>;

export const CUSTOM_TRANSFORM_ACTION: RegisteredViewportAction = {
  id: CUSTOM_TRANSFORM_ACTION_ID,
  label: "Custom Script",
  icon: Wand2,
  successMessage: "Custom script applied",
  appliedLabel: "Custom script",
  loadingMessage: "Running the transform on the stack...",
  keepsPanelOpenUntilApplySucceeds: true,
  formatAppliedLabel: formatCustomTransformAppliedLabel,
  prepareParameterValuesForApply: injectConfiguredCubeTransformForApply,
  apply: resetStateForTransformedStackOutput,
  supportsStopDuringApply: true,
  transformSourceAsync: createCustomTransformSourceTransform(),
};

function injectConfiguredCubeTransformForApply(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const config = sourceRenderingState.cubeTransform;
  if (!config) throw new Error(NO_TRANSFORM_CONFIGURED_MESSAGE);
  return Object.freeze({
    ...rawParameterValues,
    ...buildConfiguredInputParameter(config),
    [CUSTOM_TRANSFORM_MODE_PARAMETER_ID]: config.kind,
    [CUSTOM_TRANSFORM_DESCRIPTION_PARAMETER_ID]: describeCubeTransformForAudit(config),
  });
}

function buildConfiguredInputParameter(config: CubeTransformEditingState): ParameterValuesById {
  if (config.kind === "formula") {
    return { [CUSTOM_TRANSFORM_EXPRESSION_PARAMETER_ID]: config.expression.trim() };
  }
  return { [CUSTOM_TRANSFORM_SCRIPT_PATH_PARAMETER_ID]: config.filePath };
}

// The output band count can differ from the source, so band-dependent viewer
// state resets like the other band-count-changing operations. The OUTPUT panel
// starts without a configured transform; the source panel keeps its config so
// the user can adjust and Apply again.
function resetStateForTransformedStackOutput(
  state: ViewportRenderingState,
): ViewportRenderingState {
  return clearCubeTransformEditingState({
    ...state,
    selectedBandIndex: 0,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
  });
}

export function createCustomTransformSourceTransform(
  runScript: CubeTransformScriptRunner = runCubeTransformScriptThroughWorker,
): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress, abortSignal) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const scriptSource = readConfiguredScriptSource(parameterValues);
    const result = await runScript(source.raster, scriptSource, onProgress, abortSignal);
    // A stopped run may still settle with SOME outcome (the killed worker
    // reports a failure); the signal, not the outcome, decides "stopped".
    throwIfOperationStopped(abortSignal);
    return { kind: "raster", raster: buildStackFromRunResult(source.raster, result) };
  };
}

function runCubeTransformScriptThroughWorker(
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  onProgress?: TransformProgressCallback,
  abortSignal?: AbortSignal,
): Promise<ToolboxRunUserScriptResult> {
  return runUserScriptOverRasterAtApply(raster, source, "cube", onProgress, abortSignal);
}

function readConfiguredScriptSource(parameterValues: ParameterValuesById): ToolboxRunUserScriptSource {
  const expression = parameterValues[CUSTOM_TRANSFORM_EXPRESSION_PARAMETER_ID];
  if (typeof expression === "string") return { mode: "formula", expression };
  const scriptPath = parameterValues[CUSTOM_TRANSFORM_SCRIPT_PATH_PARAMETER_ID];
  if (typeof scriptPath === "string") return { mode: "import", scriptPath };
  throw new Error(NO_TRANSFORM_CONFIGURED_MESSAGE);
}

function buildStackFromRunResult(
  raster: RasterImage,
  result: ToolboxRunUserScriptResult,
): RasterImage {
  if (result.status !== "completed-cube") {
    throw new Error(describeCubeTransformRunError(describeNonCubeRunOutcome(result)));
  }
  const validated = validateTransformedCubeAgainstSource(
    result.shape,
    result.bands,
    raster.height,
    raster.width,
  );
  return buildFloat32StackFromValidatedCube(raster, validated);
}

function describeNonCubeRunOutcome(
  result: Exclude<ToolboxRunUserScriptResult, { status: "completed-cube" }>,
): string {
  if (result.status === "failed") return result.message;
  if (result.status === "canceled") return "The transform run was canceled.";
  return "The script returned an unexpected result.";
}

function buildFloat32StackFromValidatedCube(
  raster: RasterImage,
  cube: TransformedCubeResult,
): RasterImage {
  const [, height, width] = cube.shape;
  const metadata = buildTransformOutputBandMetadata(
    readSourceBandMetadata(raster),
    cube.bands.length,
  );
  const output = makeFloat32RasterFromBands(
    { width, height, bandLabels: metadata.bandLabels },
    cube.bands,
  );
  return metadata.bandWavelengths ? { ...output, bandWavelengths: metadata.bandWavelengths } : output;
}

function readSourceBandMetadata(raster: RasterImage): TransformSourceBandMetadata {
  return {
    bandCount: raster.bandCount,
    bandLabels: raster.bandLabels,
    bandWavelengths: raster.bandWavelengths,
  };
}

function formatCustomTransformAppliedLabel(parameterValues: ParameterValuesById): string {
  const description = parameterValues[CUSTOM_TRANSFORM_DESCRIPTION_PARAMETER_ID];
  if (typeof description === "string") return `Custom script (${description})`;
  return "Custom script";
}
