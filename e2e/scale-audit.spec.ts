// CT-219 scale audit driver (SCRATCH, NEVER COMMITTED).
// Each test launches its own app instance, exercises ONE audit area at the
// 8000x6000x16 uint16 reference scale (or the 14000x11000 stretch capture),
// and appends a verdict line to .scale-audit/results.jsonl via
// recordAuditResult. Failures still record evidence before rethrowing, so a
// renderer crash in one area cannot erase earlier verdicts.
//
// Run selectively: pnpm e2e scale-audit.spec.ts -g "T01"
// (dev server on :5173 first; main built via pnpm build)
import { expect, test } from "@playwright/test";
import { statSync } from "node:fs";
import { join } from "node:path";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { enqueueOpenDialogPaths, enqueueSaveDialogPath } from "./support/dialog-stub-controls";
import {
  triggerOpenProjectMenuItem,
  triggerSaveImageMenuItem,
  triggerSaveProjectMenuItem,
} from "./support/main-process";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import {
  openOperation,
  operationPanel,
  setOpenInNewPanel,
  setOperationEnumParameter,
  setOperationNumberParameter,
} from "./support/operations";
import { panelCanvas, selectPanel } from "./support/panels";
import { selectBandWiseScopeForBands, selectFullStackScope } from "./support/cube-scope-control";
import {
  selectFullImageScope,
  selectRegionOfInterestScope,
  selectWholeStackScope,
} from "./support/apply-scope-control";
import { operationRegionPlaceholder, selectOperationRegionByDrag } from "./support/operation-region-picker";
import { setThresholdBoundField, selectThresholdMethod } from "./support/threshold-editor";
import { setToneCurveAnchorField } from "./support/tone-curve-editor";
import { pinnedSpectrumLines } from "./support/spectra-plot";
import { bandWeightField } from "./support/band-weighting";
import { clickBandSelectionPreset } from "./support/band-selection";
import { chooseFlatFieldReferenceFileThroughDialog, FLAT_FIELD_LIGHT_FIELD_LABEL } from "./support/flat-field-operation";
import { chooseSaveImageFormat, confirmSaveImageFormat, saveImageFormatPicker } from "./support/save-image-flow";
import { fixturePath } from "./fixtures/fixture-manifest";

import {
  AUDIT_DIRECTORY,
  BIG_PHOTO_PATH,
  FLAT_FIELD_REFERENCE_PATH,
  REFERENCE_DIMENSIONS,
  REFERENCE_ENVI_HEADER_PATH,
  REFERENCE_STACK_PATH,
  STRETCH_CAPTURE_PATH,
  STRETCH_DIMENSIONS,
  applyOperationWithBudget,
  clickPanelButtonWithBudget,
  closeAuditResultPanel,
  countGridPanels,
  expectValueCloseTo,
  fillFormulaAndClickRunWithBudget,
  openCaptureFromDisk,
  openReferenceStackViaGroupedBandFiles,
  probeSingleFileLoad,
  readRawStatusBarReadout,
  readReportedPixelNear,
  readRendererPeakWorkingSetMb,
  readSmoothInteriorPixel,
  readVisibleToastTexts,
  recordAuditResult,
  referenceValue,
  startUiHeartbeat,
  stopUiHeartbeatAndReadMaxGapMs,
  stretchValue,
} from "./scale-audit.support";

const TEST_BUDGET_MS = 20 * 60_000;
const LOAD_BUDGET_MS = 8 * 60_000;
const APPLY_BUDGET_MS = 12 * 60_000;
const SCRIPT_RUN_BUDGET_MS = 6 * 60_000;
const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;

let launched: LaunchedApp;

test.beforeEach(async () => {
  test.setTimeout(TEST_BUDGET_MS);
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
});

async function loadReferenceStack(): Promise<number> {
  const loadMs = await openReferenceStackViaGroupedBandFiles(launched.window, LOAD_BUDGET_MS);
  await selectPanel(launched.window, SOURCE_PANEL);
  return loadMs;
}

interface SimpleOpAudit {
  readonly area: string;
  readonly operationLabel: string;
  readonly configure?: () => Promise<void>;
  readonly verifyResult?: () => Promise<string>;
  readonly closeResult?: boolean;
}

async function auditOperation(op: SimpleOpAudit): Promise<void> {
  await selectPanel(launched.window, SOURCE_PANEL);
  const openedAt = Date.now();
  await openOperation(launched.window, op.operationLabel);
  const openMs = Date.now() - openedAt;
  if (op.configure) await op.configure();
  try {
    const timing = await applyOperationWithBudget(launched.window, op.operationLabel, APPLY_BUDGET_MS);
    const oracle = op.verifyResult ? await op.verifyResult() : "not-checked";
    recordAuditResult({
      area: op.area,
      verdict: timing.maxUiGapMs > 5000 ? "finding: UI freeze > 5s with no progress feedback" : "pass",
      openMs,
      applyMs: timing.applyMs,
      maxUiGapMs: timing.maxUiGapMs,
      sawProgressBar: timing.sawDeterminateProgressBar,
      oracle,
      rendererMb: await readRendererPeakWorkingSetMb(launched.app),
    });
  } catch (error) {
    recordAuditResult({
      area: op.area,
      verdict: "finding: hard failure",
      openMs,
      error: String(error),
      toasts: await readVisibleToastTexts(launched.window).catch(() => []),
      panels: await countGridPanels(launched.window).catch(() => -1),
      rendererDied: launched.window.isClosed(),
      rendererMb: await readRendererPeakWorkingSetMb(launched.app).catch(() => -1),
    });
    throw error;
  }
  if (op.closeResult !== false) await closeAuditResultPanel(launched.window, RESULT_PANEL);
}

async function verifyResultBandOne(
  expectedFromPixel: (x: number, y: number) => number,
  tolerance: number,
): Promise<string> {
  const reported = await readReportedPixelNear(
    launched.window,
    RESULT_PANEL,
    { x: 2450, y: 1850 },
    REFERENCE_DIMENSIONS,
  );
  const expected = expectedFromPixel(reported.x, reported.y);
  expectValueCloseTo(reported.value, expected, tolerance, "result band 1 readout");
  return `pixel (${reported.x}, ${reported.y}) read ${reported.value}, expected ${expected}`;
}

// ---------------------------------------------------------------------------

test("T00a single-file reference TIFF load probe (1.54 GB)", async () => {
  const outcome = await probeSingleFileLoad(launched.window, REFERENCE_STACK_PATH, 3 * 60_000);
  recordAuditResult({
    area: "load: reference TIFF as ONE 1.54 GB file (geotiff, 16 pages)",
    verdict: outcome.kind === "loaded" ? "pass" : "finding: hard failure (single-file load at reference scale)",
    outcome,
  });
});

test("T00b single-file load probe at 384 MB (4 bands)", async () => {
  const outcome = await probeSingleFileLoad(launched.window, join(AUDIT_DIRECTORY, "probe-4band.tif"), 3 * 60_000);
  recordAuditResult({
    area: "load: single-file 384 MB TIFF (4 bands, size-cliff probe)",
    verdict: outcome.kind === "loaded" ? "pass" : "finding: hard failure below reference scale",
    outcome,
    rendererMb: outcome.kind === "loaded" ? await readRendererPeakWorkingSetMb(launched.app) : -1,
  });
});

test("T00c single-file load probe at 768 MB (8 bands)", async () => {
  const outcome = await probeSingleFileLoad(launched.window, join(AUDIT_DIRECTORY, "probe-8band.tif"), 3 * 60_000);
  recordAuditResult({
    area: "load: single-file 768 MB TIFF (8 bands, size-cliff probe)",
    verdict: outcome.kind === "loaded" ? "pass" : "finding: hard failure below reference scale",
    outcome,
    rendererMb: outcome.kind === "loaded" ? await readRendererPeakWorkingSetMb(launched.app) : -1,
  });
});

test("T00d single-file load probe at 1.15 GB (12 bands)", async () => {
  const outcome = await probeSingleFileLoad(launched.window, join(AUDIT_DIRECTORY, "probe-12band.tif"), 3 * 60_000);
  recordAuditResult({
    area: "load: single-file 1.15 GB TIFF (12 bands, size-cliff probe)",
    verdict: outcome.kind === "loaded" ? "pass" : "finding: hard failure below reference scale",
    outcome,
    rendererMb: outcome.kind === "loaded" ? await readRendererPeakWorkingSetMb(launched.app) : -1,
  });
});

test("T01 grouped load + GPU display + pixel readout + spectra + histogram", async () => {
  const loadMs = await loadReferenceStack();
  recordAuditResult({
    area: "load: reference stack via 16 grouped per-band files (Review stacks path)",
    verdict: "pass",
    loadMs,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });

  const fraction = await nonClearPixelFraction(
    await summarizeCanvasPixels(panelCanvas(launched.window, SOURCE_PANEL)),
  );
  recordAuditResult({
    area: "GPU texture upload + display (WebGL2, 12 tiles/band)",
    verdict: fraction > 0.1 ? "pass" : "finding: canvas shows no content",
    nonClearFraction: fraction,
  });

  const reported = await readReportedPixelNear(launched.window, SOURCE_PANEL, { x: 2450, y: 1850 }, REFERENCE_DIMENSIONS);
  const expected = referenceValue(0, reported.x, reported.y);
  recordAuditResult({
    area: "pixel readout (status bar oracle)",
    verdict: reported.value === expected ? "pass" : "finding: wrong readout value",
    detail: `pixel (${reported.x}, ${reported.y}) read ${reported.value}, expected ${expected}`,
  });

  const canvasBox = await panelCanvas(launched.window, SOURCE_PANEL).boundingBox();
  if (!canvasBox) throw new Error("no canvas box");
  await launched.window.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await expect(pinnedSpectrumLines(launched.window).first()).toBeVisible({ timeout: 60_000 });
  recordAuditResult({ area: "spectra sampling (pinned pixel spectrum, 16 bands)", verdict: "pass" });

  const histogramStartedAt = Date.now();
  await expect(
    launched.window.locator('section[aria-label="Histogram"] canvas'),
  ).toBeVisible({ timeout: 120_000 });
  recordAuditResult({
    area: "histogram computation (worker-backed, 48 MP band)",
    verdict: "pass",
    histogramVisibleMs: Date.now() - histogramStartedAt,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });
});

test("T02 invert", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Invert (uint16, whole stack)",
    operationLabel: "Invert",
    verifyResult: () => verifyResultBandOne((x, y) => 65535 - referenceValue(0, x, y), 0.5),
  });
});

test("T03 bit shift", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Bit Shift (by 4)",
    operationLabel: "Bit Shift",
    verifyResult: () => verifyResultBandOne((x, y) => referenceValue(0, x, y) * 16, 0.5),
  });
});

test("T04 brightness & contrast", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Brightness & Contrast (defaults)",
    operationLabel: "Brightness & Contrast",
    verifyResult: () => verifyResultBandOne((x, y) => referenceValue(0, x, y), 1),
  });
});

test("T05 clip by value (Normalize clip-absolute)", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Clip by value (Normalize method clip-absolute, full stack)",
    operationLabel: "Normalize",
    configure: async () => {
      await setOperationEnumParameter(launched.window, "Normalize", "clip-absolute");
      await selectFullStackScope(launched.window, "Normalize");
      await setOperationNumberParameter(launched.window, "Normalize", "Clip low", 1050);
      await setOperationNumberParameter(launched.window, "Normalize", "Clip high", 15000);
    },
    verifyResult: () =>
      verifyResultBandOne((x, y) => Math.min(15000, Math.max(1050, referenceValue(0, x, y))), 0.5),
  });
});

test("T06 normalize min-max full stack", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Normalize (min-max, full stack)",
    operationLabel: "Normalize",
    configure: async () => {
      await selectFullStackScope(launched.window, "Normalize");
    },
    verifyResult: () =>
      verifyResultBandOne((x, y) => (referenceValue(0, x, y) - 1000) / (16198 - 1000), 0.001),
  });
});

test("T07 standardize band-wise", async () => {
  await loadReferenceStack();
  const RAMP_STD = 40.8218; // sqrt(2 * var(uniform 0..99)) = sqrt(2 * 833.25)
  await auditOperation({
    area: "operation: Standardize (band-wise, all 16 bands)",
    operationLabel: "Standardize",
    configure: async () => {
      await selectBandWiseScopeForBands(launched.window, "Standardize", "1-16");
    },
    verifyResult: () =>
      verifyResultBandOne((x, y) => (referenceValue(0, x, y) - 1099) / RAMP_STD, 0.05),
  });
});

test("T08 tone curve full image + whole stack + ROI", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Contrast Curve (Full image scope, flat-max curve)",
    operationLabel: "Contrast Curve",
    configure: async () => {
      await selectFullImageScope(launched.window, "Contrast Curve");
      await setToneCurveAnchorField(launched.window, "New value", 65535);
    },
    verifyResult: () => verifyResultBandOne(() => 65535, 1),
  });
  await auditOperation({
    area: "operation: Contrast Curve (Whole stack scope)",
    operationLabel: "Contrast Curve",
    configure: async () => {
      await selectWholeStackScope(launched.window, "Contrast Curve");
      await setToneCurveAnchorField(launched.window, "New value", 65535);
    },
    verifyResult: () => verifyResultBandOne(() => 65535, 1),
  });
  await auditOperation({
    area: "operation: Contrast Curve (Region of interest scope)",
    operationLabel: "Contrast Curve",
    configure: async () => {
      await selectRegionOfInterestScope(launched.window, "Contrast Curve");
      await selectOperationRegionByDrag(launched.window, {
        panelNumber: SOURCE_PANEL,
        operationLabel: "Contrast Curve",
        startPixel: { x: 1000, y: 1000 },
        endPixel: { x: 3000, y: 2600 },
        imageDimensions: REFERENCE_DIMENSIONS,
      });
    },
  });
});

test("T09 threshold manual + Otsu", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Threshold (manual bounds)",
    operationLabel: "Threshold",
    configure: async () => {
      await setThresholdBoundField(launched.window, "Lower", 1100);
    },
    verifyResult: () =>
      verifyResultBandOne((x, y) => (referenceValue(0, x, y) >= 1100 ? 255 : 0), 0.5),
  });
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, "Threshold");
  const otsuStartedAt = Date.now();
  await selectThresholdMethod(launched.window, "Otsu threshold");
  const timing = await applyOperationWithBudget(launched.window, "Threshold", APPLY_BUDGET_MS);
  recordAuditResult({
    area: "operation: Threshold (Otsu method)",
    verdict: timing.maxUiGapMs > 5000 ? "finding: UI freeze > 5s" : "pass",
    otsuMs: Date.now() - otsuStartedAt,
    applyMs: timing.applyMs,
    maxUiGapMs: timing.maxUiGapMs,
  });
});

test("T10 percentile clip band-wise", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Percentile Clip (band-wise: band 1)",
    operationLabel: "Percentile Clip",
    configure: async () => {
      await selectBandWiseScopeForBands(launched.window, "Percentile Clip", "1");
    },
    verifyResult: async () => {
      const reported = await readSmoothInteriorPixel(launched.window, RESULT_PANEL, REFERENCE_DIMENSIONS);
      return `mid-window pixel (${reported.x}, ${reported.y}) read ${reported.value} (source ${referenceValue(0, reported.x, reported.y)})`;
    },
  });
});

test("T11 percentile clip FULL STACK concatenate-and-sort", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Percentile Clip (full stack, concatenate-and-sort over 768M values)",
    operationLabel: "Percentile Clip",
  });
});

test("T12 denoise gaussian + median", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Denoise (gaussian, radius 1, full stack)",
    operationLabel: "Denoise",
    verifyResult: async () => {
      const reported = await readSmoothInteriorPixel(launched.window, RESULT_PANEL, REFERENCE_DIMENSIONS);
      const expected = referenceValue(0, reported.x, reported.y);
      expectValueCloseTo(reported.value, expected, 1.5, "gaussian on locally-linear ramp");
      return `pixel (${reported.x}, ${reported.y}) read ${reported.value}, expected ~${expected}`;
    },
  });
  await auditOperation({
    area: "operation: Denoise (median, radius 1, full stack)",
    operationLabel: "Denoise",
    configure: async () => {
      await setOperationEnumParameter(launched.window, "Denoise", "median");
    },
    verifyResult: async () => {
      const reported = await readSmoothInteriorPixel(launched.window, RESULT_PANEL, REFERENCE_DIMENSIONS);
      const expected = referenceValue(0, reported.x, reported.y);
      expectValueCloseTo(reported.value, expected, 0.5, "median on locally-linear ramp");
      return `pixel (${reported.x}, ${reported.y}) read ${reported.value}, expected ${expected}`;
    },
  });
});

test("T13 spatial filter at reference scale (CT-219a verify)", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Spatial Filter (lowpass default, worker-backed, CT-219a fix verify)",
    operationLabel: "Spatial Filter",
    verifyResult: async () => {
      const raw = await readRawStatusBarReadout(
        launched.window,
        RESULT_PANEL,
        { x: 2450, y: 1850 },
        REFERENCE_DIMENSIONS,
      );
      const fraction = await nonClearPixelFraction(
        await summarizeCanvasPixels(panelCanvas(launched.window, RESULT_PANEL)),
      );
      const reported = await readSmoothInteriorPixel(launched.window, RESULT_PANEL, REFERENCE_DIMENSIONS).catch(
        (error) => ({ error: String(error) }),
      );
      return `raw readout [${raw}], result canvas non-clear fraction ${fraction}, finite readout ${JSON.stringify(reported)}`;
    },
  });
});

test("T14 spectral derivative", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Spectral Derivative (order 1)",
    operationLabel: "Spectral Derivative",
    verifyResult: () => verifyResultBandOne(() => 1000, 0.5),
  });
});

test("T15 false-color composite", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: RGB Color Composite (bands 16/8/1)",
    operationLabel: "RGB Color Composite",
    configure: async () => {
      await setOperationNumberParameter(launched.window, "RGB Color Composite", "Band R", 16);
      await setOperationNumberParameter(launched.window, "RGB Color Composite", "Band G", 8);
      await setOperationNumberParameter(launched.window, "RGB Color Composite", "Band B", 1);
    },
    verifyResult: async () => {
      const fraction = await nonClearPixelFraction(
        await summarizeCanvasPixels(panelCanvas(launched.window, RESULT_PANEL)),
      );
      if (fraction < 0.1) throw new Error(`composite canvas nearly empty (${fraction})`);
      return `composite canvas non-clear fraction ${fraction}`;
    },
  });
});

test("T16 rotate + reflect + crop", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Rotate (90 clockwise)",
    operationLabel: "Rotate",
  });
  await auditOperation({
    area: "operation: Reflect (horizontal)",
    operationLabel: "Reflect",
    verifyResult: () =>
      verifyResultBandOne((x, y) => referenceValue(0, REFERENCE_DIMENSIONS.width - 1 - x, y), 0.5),
  });
  // Crop is the only region operation whose Apply truly gates on a committed
  // region, so it is the honest probe of the drag-commit path at scale. Record
  // evidence (placeholder state, toasts) if the region never commits.
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, "Crop to Region");
  try {
    await selectOperationRegionByDrag(launched.window, {
      panelNumber: SOURCE_PANEL,
      operationLabel: "Crop to Region",
      startPixel: { x: 1000, y: 1000 },
      endPixel: { x: 3000, y: 2600 },
      imageDimensions: REFERENCE_DIMENSIONS,
    });
  } catch (error) {
    const panel = operationPanel(launched.window, "Crop to Region");
    recordAuditResult({
      area: "operation: Crop to Region (~2000x1600 region)",
      verdict: "finding: hard failure (region drag never enables Apply at reference scale)",
      error: String(error).slice(0, 200),
      placeholderStillVisible: await operationRegionPlaceholder(launched.window, "Crop to Region")
        .isVisible()
        .catch(() => "unknown"),
      panelText: (await panel.innerText().catch(() => "<unreadable>")).slice(0, 400),
      toasts: await readVisibleToastTexts(launched.window).catch(() => []),
    });
    throw error;
  }
  try {
    const cropTiming = await applyOperationWithBudget(launched.window, "Crop to Region", APPLY_BUDGET_MS);
    recordAuditResult({
      area: "operation: Crop to Region (~2000x1600 region)",
      verdict: cropTiming.maxUiGapMs > 5000 ? "finding: UI freeze > 5s with no progress feedback" : "pass",
      applyMs: cropTiming.applyMs,
      maxUiGapMs: cropTiming.maxUiGapMs,
      rendererMb: await readRendererPeakWorkingSetMb(launched.app),
    });
  } catch (error) {
    recordAuditResult({
      area: "operation: Crop to Region (~2000x1600 region)",
      verdict: "finding: hard failure during apply",
      error: String(error).slice(0, 400),
      toasts: await readVisibleToastTexts(launched.window).catch(() => []),
      rendererDied: launched.window.isClosed(),
      rendererMb: await readRendererPeakWorkingSetMb(launched.app).catch(() => -1),
    });
    throw error;
  }
});

test("T17 flat-field + spectralon", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Flat-field Correction (48 MP single-band light reference from file)",
    operationLabel: "Flat-field Correction",
    configure: async () => {
      await chooseFlatFieldReferenceFileThroughDialog(
        launched.window,
        FLAT_FIELD_LIGHT_FIELD_LABEL,
        FLAT_FIELD_REFERENCE_PATH,
      );
    },
  });
  await auditOperation({
    area: "operation: Spectralon Calibration (region + known reflectance 1)",
    operationLabel: "Spectralon Calibration",
    configure: async () => {
      await setOperationNumberParameter(launched.window, "Spectralon Calibration", "Known reflectance", 1);
      await selectOperationRegionByDrag(launched.window, {
        panelNumber: SOURCE_PANEL,
        operationLabel: "Spectralon Calibration",
        startPixel: { x: 1000, y: 1000 },
        endPixel: { x: 1400, y: 1400 },
        imageDimensions: REFERENCE_DIMENSIONS,
      });
    },
  });
});

test("T18 PCA", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: PCA (3 components, sync fit + full-cube projection)",
    operationLabel: "PCA",
    configure: async () => {
      await setOperationNumberParameter(launched.window, "PCA", "Components", 3);
    },
    verifyResult: async () => {
      const reported = await readReportedPixelNear(launched.window, RESULT_PANEL, { x: 2450, y: 1850 }, REFERENCE_DIMENSIONS);
      if (!Number.isFinite(reported.value)) throw new Error("PCA component not finite");
      return `finite component value ${reported.value}`;
    },
  });
});

test("T19 MNF", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: MNF (3 components, streamed noise covariance)",
    operationLabel: "MNF",
    configure: async () => {
      await setOperationNumberParameter(launched.window, "MNF", "Components", 3);
    },
  });
});

test("T20 ICA", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: ICA (3 components, iterative fit)",
    operationLabel: "ICA",
    configure: async () => {
      await setOperationNumberParameter(launched.window, "ICA", "Components", 3);
    },
  });
});

test("T21 band selection preset + band weighting apply", async () => {
  await loadReferenceStack();
  await auditOperation({
    area: "operation: Band Selection (Average preset, sync TS reduction)",
    operationLabel: "Band Selection",
    configure: async () => {
      await clickBandSelectionPreset(launched.window, "Average");
    },
    verifyResult: () => verifyResultBandOne((x, y) => 8500 + (x % 100) + (y % 100), 0.5),
  });
});

test("T22 band weighting python run at scale (30s wall clock)", async () => {
  await loadReferenceStack();
  await openOperation(launched.window, "Band Weighting");
  const startedAt = Date.now();
  await startUiHeartbeat(launched.window);
  // np.arange gives band 2 the weight 2, distinguishable from the default 1s.
  await fillFormulaAndClickRunWithBudget(
    launched.window,
    "Band Weighting",
    "Weight formula",
    "np.arange(1, cube.shape[0] + 1)",
    SCRIPT_RUN_BUDGET_MS,
  );
  const outcome = await waitForScriptOutcome(async () => {
    const populated = (await bandWeightField(launched.window, 2).inputValue().catch(() => "")) === "2";
    return populated ? "weights populated from formula" : null;
  });
  const runUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
  recordAuditResult({
    area: "python round trip: Band Weighting formula run (3 GB cube over IPC, 30 s wall clock)",
    verdict: describeScriptRunVerdict(outcome.startsWith("weights"), runUiGapMs),
    outcome,
    runUiGapMs,
    elapsedMs: Date.now() - startedAt,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });
  if (!outcome.startsWith("weights")) return;
  // Apply the populated weights: sync TS weighted sum over 16 bands.
  // weights 1..16 normalized by 136 -> 11000 + ramp at every pixel.
  const timing = await applyOperationWithBudget(launched.window, "Band Weighting", APPLY_BUDGET_MS);
  const oracle = await verifyResultBandOne((x, y) => 11000 + (x % 100) + (y % 100), 0.5);
  recordAuditResult({
    area: "operation: Band Weighting (apply weights 1..16, sync TS weighted sum)",
    verdict: timing.maxUiGapMs > 5000 ? "finding: UI freeze > 5s with no progress feedback" : "pass",
    applyMs: timing.applyMs,
    maxUiGapMs: timing.maxUiGapMs,
    oracle,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });
});

test("T23 band selection formula python run (JSON tolist of 48 MP band)", async () => {
  await loadReferenceStack();
  await openOperation(launched.window, "Band Selection");
  const startedAt = Date.now();
  await startUiHeartbeat(launched.window);
  await fillFormulaAndClickRunWithBudget(
    launched.window,
    "Band Selection",
    "Band formula",
    "cube.max(axis=0)",
    SCRIPT_RUN_BUDGET_MS,
  );
  const outcome = await waitForScriptOutcome(async () => {
    const status = await operationPanel(launched.window, "Band Selection")
      .getByText("Selected function:", { exact: false })
      .innerText()
      .catch(() => "");
    return status.includes("formula") || status.includes("Formula") ? status : null;
  });
  const runUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
  recordAuditResult({
    area: "python round trip: Band Selection formula (H x W band via JSON tolist, 30 s wall clock)",
    verdict: describeScriptRunVerdict(outcome.startsWith("Selected"), runUiGapMs),
    outcome,
    runUiGapMs,
    elapsedMs: Date.now() - startedAt,
  });
  if (!outcome.startsWith("Selected")) return;
  // Apply the remembered custom band: max over bands = band 16 = 16000 + ramp.
  const timing = await applyOperationWithBudget(launched.window, "Band Selection", APPLY_BUDGET_MS);
  const oracle = await verifyResultBandOne((x, y) => 16000 + (x % 100) + (y % 100), 0.5);
  recordAuditResult({
    area: "operation: Band Selection (apply formula-selected band from the result store)",
    verdict: timing.maxUiGapMs > 5000 ? "finding: UI freeze > 5s with no progress feedback" : "pass",
    applyMs: timing.applyMs,
    maxUiGapMs: timing.maxUiGapMs,
    oracle,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });
});

test("T24 custom transform formula python run (raw float32 frame, 120s wall clock)", async () => {
  await loadReferenceStack();
  await openOperation(launched.window, "Custom Script");
  const startedAt = Date.now();
  await startUiHeartbeat(launched.window);
  await fillFormulaAndClickRunWithBudget(
    launched.window,
    "Custom Script",
    "Transform formula",
    "cube * 2",
    SCRIPT_RUN_BUDGET_MS,
  );
  const outcome = await waitForScriptOutcome(async () => {
    const status = await operationPanel(launched.window, "Custom Script")
      .getByText("Transform ready:", { exact: false })
      .innerText()
      .catch(() => "");
    return status.length > 0 ? status : null;
  });
  const runUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
  const elapsedMs = Date.now() - startedAt;
  if (!outcome.startsWith("Transform ready")) {
    recordAuditResult({
      area: "python round trip: Custom Transform formula (structured-clone cube IPC + raw float32 response frame, 120 s wall clock)",
      verdict: "finding: run failed at scale",
      outcome,
      runUiGapMs,
      elapsedMs,
    });
    return;
  }
  const timing = await applyOperationWithBudget(launched.window, "Custom Script", APPLY_BUDGET_MS);
  const oracle = await verifyResultBandOne((x, y) => 2 * referenceValue(0, x, y), 0.5);
  recordAuditResult({
    area: "python round trip: Custom Transform formula (structured-clone cube IPC + raw float32 response frame, 120 s wall clock)",
    verdict:
      timing.maxUiGapMs > 5000 || runUiGapMs > 5000 ? "finding: UI freeze > 5s" : "pass",
    outcome,
    runMs: elapsedMs,
    runUiGapMs,
    applyMs: timing.applyMs,
    maxUiGapMs: timing.maxUiGapMs,
    oracle,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });
});

test("T25 custom transform imported tool at scale", async () => {
  await loadReferenceStack();
  await openOperation(launched.window, "Custom Script");
  await enqueueOpenDialogPaths(launched.window, [fixturePath("transform-tool.py")]);
  const startedAt = Date.now();
  await startUiHeartbeat(launched.window);
  await clickPanelButtonWithBudget(
    launched.window,
    "Custom Script",
    "Import script...",
    SCRIPT_RUN_BUDGET_MS,
  );
  const outcome = await waitForScriptOutcome(async () => {
    const status = await operationPanel(launched.window, "Custom Script")
      .getByText("Transform ready:", { exact: false })
      .innerText()
      .catch(() => "");
    return status.length > 0 ? status : null;
  });
  const runUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
  recordAuditResult({
    area: "python round trip: Custom Transform imported tool (np.flip over the whole cube)",
    verdict: describeScriptRunVerdict(outcome.startsWith("Transform ready"), runUiGapMs),
    outcome,
    runUiGapMs,
    elapsedMs: Date.now() - startedAt,
  });
});

test("T26 project save + reopen", async () => {
  await loadReferenceStack();
  // Invert in place first so the raster is MODIFIED: save must then BAKE the
  // full 1.5 GB stack into the bundle (the risky large-asset IPC path) instead
  // of referencing the on-disk source files.
  await openOperation(launched.window, "Invert");
  await setOpenInNewPanel(launched.window, "Invert", false);
  await applyOperationWithBudget(launched.window, "Invert", APPLY_BUDGET_MS).catch(async (error) => {
    recordAuditResult({ area: "project save precondition (in-place invert)", verdict: "note", error: String(error) });
  });
  const bundlePath = join(AUDIT_DIRECTORY, "audit-project.ctbundle");
  await enqueueSaveDialogPath(launched.window, bundlePath);
  const saveStartedAt = Date.now();
  await triggerSaveProjectMenuItem(launched.app);
  try {
    await expect(launched.window.getByText("Saved project to", { exact: false }).first()).toBeVisible({
      timeout: LOAD_BUDGET_MS,
    });
  } catch (error) {
    recordAuditResult({
      area: "project save + reopen (bundle writer, modified 1.5 GB stack baked)",
      verdict: "finding: hard failure during save",
      rendererDied: launched.window.isClosed(),
      error: String(error).slice(0, 300),
      toasts: await readVisibleToastTexts(launched.window).catch(() => []),
    });
    throw error;
  }
  const saveMs = Date.now() - saveStartedAt;
  const bundleBytes = statSync(bundlePath).size;

  await enqueueOpenDialogPaths(launched.window, [bundlePath]);
  const reopenStartedAt = Date.now();
  await triggerOpenProjectMenuItem(launched.app);
  await expect(launched.window.getByText("Opened project", { exact: false }).first()).toBeVisible({
    timeout: LOAD_BUDGET_MS,
  });
  const reopenMs = Date.now() - reopenStartedAt;
  const reported = await readReportedPixelNear(launched.window, SOURCE_PANEL, { x: 2450, y: 1850 }, REFERENCE_DIMENSIONS);
  const expected = 65535 - referenceValue(0, reported.x, reported.y);
  recordAuditResult({
    area: "project save + reopen (bundle writer, modified 1.5 GB stack baked)",
    verdict: reported.value === expected ? "pass" : "finding: reopened values wrong",
    saveMs,
    reopenMs,
    bundleBytes,
    detail: `reopened pixel (${reported.x}, ${reported.y}) read ${reported.value}, expected ${expected} (inverted)`,
  });
});

test("T27 export encoders TIFF/PNG/JPEG/ENVI", async () => {
  await loadReferenceStack();
  await auditExport("TIFF (16-bit)", "audit-export.tif");
  await auditExport("PNG (8-bit)", "audit-export.png");
  await auditExport("JPEG (8-bit)", "audit-export.jpg");
  await auditExport("ENVI (.hdr + .bin)", "audit-export.hdr");
});

async function auditExport(formatLabel: string, fileName: string): Promise<void> {
  const destinationPath = join(AUDIT_DIRECTORY, fileName);
  await enqueueSaveDialogPath(launched.window, destinationPath);
  await triggerSaveImageMenuItem(launched.app);
  await expect(saveImageFormatPicker(launched.window)).toBeVisible({ timeout: 30_000 });
  await chooseSaveImageFormat(launched.window, formatLabel);
  await startUiHeartbeat(launched.window);
  const startedAt = Date.now();
  await confirmSaveImageFormat(launched.window);
  try {
    await expect(launched.window.getByText("Saved to", { exact: false }).first()).toBeVisible({
      timeout: APPLY_BUDGET_MS,
    });
    const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
    recordAuditResult({
      area: `export: ${formatLabel}`,
      verdict: maxUiGapMs > 5000 ? "finding: UI freeze > 5s during export" : "pass",
      exportMs: Date.now() - startedAt,
      maxUiGapMs,
      fileBytes: statSync(destinationPath).size,
    });
  } catch (error) {
    recordAuditResult({
      area: `export: ${formatLabel}`,
      verdict: "finding: export failed",
      error: String(error),
      toasts: await readVisibleToastTexts(launched.window).catch(() => []),
    });
    throw error;
  }
  // Sonner toasts persist ~4 s; wait them out so the next export's "Saved to"
  // assertion cannot match this export's toast.
  await launched.window.waitForTimeout(6000);
}

test("T28 ENVI loader at scale", async () => {
  const outcome = await probeSingleFileLoad(launched.window, REFERENCE_ENVI_HEADER_PATH, 3 * 60_000);
  if (outcome.kind !== "loaded") {
    recordAuditResult({
      area: "load: ENVI (.hdr + 1.54 GB BSQ .bin, sync decode)",
      verdict: "finding: hard failure at reference scale",
      outcome,
    });
    return;
  }
  const reported = await readReportedPixelNear(launched.window, SOURCE_PANEL, { x: 2450, y: 1850 }, REFERENCE_DIMENSIONS);
  const expected = referenceValue(0, reported.x, reported.y);
  recordAuditResult({
    area: "load: ENVI (.hdr + 1.54 GB BSQ .bin, sync decode)",
    verdict: reported.value !== expected ? "finding: wrong decoded value" : "pass",
    loadMs: outcome.loadMs,
    detail: `pixel (${reported.x}, ${reported.y}) read ${reported.value}, expected ${expected}`,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });
});

test("T29 browser photo promotion + rgb-to-grayscale", async () => {
  await startUiHeartbeat(launched.window);
  const loadMs = await openCaptureFromDisk(launched.window, BIG_PHOTO_PATH, LOAD_BUDGET_MS);
  const maxUiGapMs = await stopUiHeartbeatAndReadMaxGapMs(launched.window);
  recordAuditResult({
    area: "load: browser photo promotion (48 MP RGB PNG, sync canvas decode)",
    verdict: maxUiGapMs > 5000 ? "finding: UI freeze > 5s during load" : "pass",
    loadMs,
    maxUiGapMs,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, "RGB to Grayscale");
  const timing = await applyOperationWithBudget(launched.window, "RGB to Grayscale", APPLY_BUDGET_MS);
  const reported = await readReportedPixelNear(launched.window, RESULT_PANEL, { x: 2450, y: 1850 }, REFERENCE_DIMENSIONS);
  recordAuditResult({
    area: "operation: RGB to Grayscale (48 MP photo)",
    verdict: timing.maxUiGapMs > 5000 ? "finding: UI freeze > 5s" : "pass",
    applyMs: timing.applyMs,
    maxUiGapMs: timing.maxUiGapMs,
    detail: `gray value ${reported.value} at (${reported.x}, ${reported.y})`,
  });
});

test("T30 stretch capture: load + display + spatial filter graceful failure", async () => {
  const outcome = await probeSingleFileLoad(launched.window, STRETCH_CAPTURE_PATH, 3 * 60_000);
  if (outcome.kind !== "loaded") {
    recordAuditResult({
      area: "stretch: load + display + readout (150 MP single band, 308 MB file)",
      verdict: "stretch-case behavior: load fails (see outcome)",
      outcome,
    });
    return;
  }
  const reported = await readReportedPixelNear(launched.window, SOURCE_PANEL, { x: 4450, y: 3850 }, STRETCH_DIMENSIONS);
  const expected = stretchValue(reported.x, reported.y);
  recordAuditResult({
    area: "stretch: load + display + readout (150 MP single band)",
    verdict: reported.value === expected ? "stretch-case behavior: loads and reads correctly" : "finding: wrong value at stretch scale",
    loadMs: outcome.loadMs,
    detail: `pixel (${reported.x}, ${reported.y}) read ${reported.value}, expected ${expected}`,
    rendererMb: await readRendererPeakWorkingSetMb(launched.app),
  });

  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, "Spatial Filter");
  await operationPanel(launched.window, "Spatial Filter").getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(async () => (await readVisibleToastTexts(launched.window)).join(" | "), { timeout: 60_000 })
    .toContain("Spatial Filter");
  const toasts = await readVisibleToastTexts(launched.window);
  recordAuditResult({
    area: "stretch: Spatial Filter pre-flight rejection (CT-219a graceful failure verify)",
    verdict: toasts.some((t) => t.includes("allocation failed")) ? "finding: raw V8 error leaked" : "stretch-case behavior: graceful in-vocabulary error",
    toasts,
  });
});

// T22-T25 all abort the same way: the Run formula / Import click never acks
// because the renderer main thread goes unresponsive dispatching the 3 GB cube
// into the user-script IPC. This diagnosis observes the frozen renderer from
// OUTSIDE (main-process metrics, python worker spawn, click ack) so the finding
// gets evidence instead of a bare Playwright timeout.
test("T31 python round trip freeze diagnosis (band weighting run at scale)", async () => {
  await loadReferenceStack();
  await openOperation(launched.window, "Band Weighting");
  const panel = operationPanel(launched.window, "Band Weighting");
  await panel.getByLabel("Weight formula", { exact: true }).fill("np.arange(1, cube.shape[0] + 1)");
  const clickStartedAt = Date.now();
  const clickState: { outcome: string | null } = { outcome: null };
  const clickPromise = panel
    .getByRole("button", { name: "Run formula", exact: true })
    .click({ timeout: 14 * 60_000 })
    .then(() => {
      clickState.outcome = `click acked after ${Date.now() - clickStartedAt}ms`;
    })
    .catch((error) => {
      clickState.outcome = `click never acked: ${String(error).slice(0, 140)}`;
    });
  const observations: string[] = [];
  for (let sample = 0; sample < 40 && clickState.outcome === null; sample += 1) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 15_000));
    observations.push(await observeProcessesFromOutsideRenderer(clickStartedAt));
  }
  await Promise.race([clickPromise, new Promise((r) => setTimeout(r, 1000))]);
  const weightsPopulated = clickState.outcome?.startsWith("click acked")
    ? (await bandWeightField(launched.window, 2).inputValue().catch(() => "<unreadable>")) === "2"
    : false;
  recordAuditResult({
    area: "python round trip: ALL consumers at reference scale (formula/tool run over the 3 GB cube IPC)",
    verdict: weightsPopulated
      ? "pass (see observations for freeze duration)"
      : "finding: hard failure (renderer unresponsive dispatching the cube to the user-script IPC)",
    clickOutcome: clickState.outcome,
    weightsPopulated,
    observations,
    rendererDied: launched.window.isClosed(),
  });
});

async function observeProcessesFromOutsideRenderer(startedAt: number): Promise<string> {
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  const metrics = await launched.app
    .evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}MB`)
        .join(" "),
    )
    .catch((error) => `metrics failed: ${String(error).slice(0, 80)}`);
  const pythonRunning = await checkWhetherPythonWorkerIsRunning();
  return `t=${elapsedSeconds}s python=${pythonRunning} ${metrics}`;
}

async function checkWhetherPythonWorkerIsRunning(): Promise<string> {
  const { execSync } = await import("node:child_process");
  try {
    const list = execSync('tasklist /FI "IMAGENAME eq python.exe" /FO CSV /NH', {
      encoding: "utf8",
      timeout: 10_000,
    });
    return list.includes("python.exe") ? "yes" : "no";
  } catch {
    return "unknown";
  }
}

function describeScriptRunVerdict(succeeded: boolean, runUiGapMs: number): string {
  if (!succeeded) return "finding: run failed at scale";
  if (runUiGapMs > 5000) return "finding: UI freeze > 5s during script run (no progress feedback)";
  return "pass";
}

// Polls for a script-run outcome: the caller's probe returns a non-null success
// string, or an error toast appears, or the budget elapses.
async function waitForScriptOutcome(probeSuccess: () => Promise<string | null>): Promise<string> {
  const deadline = Date.now() + SCRIPT_RUN_BUDGET_MS;
  while (Date.now() < deadline) {
    if (launched.window.isClosed()) return "renderer died during the script run";
    const success = await probeSuccess().catch(() => null);
    if (success) return success;
    const toasts = await readVisibleToastTexts(launched.window).catch(() => []);
    const failure = toasts.find((t) => t.toLowerCase().includes("failed") || t.toLowerCase().includes("error"));
    if (failure) return `error toast: ${failure}`;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 1000));
  }
  return "timed out waiting for a script outcome";
}
