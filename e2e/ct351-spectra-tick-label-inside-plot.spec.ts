import { expect, test } from "@playwright/test";

import { enviNirStack } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  loadFixtureAsStack,
  pinPixelSpectrum,
  readSpectraPlotAxisLabels,
  spectraPlot,
} from "./support/page-objects";

// CT-351: Wallace saw wavelengths above 1000 clipped at the end of the Spectra
// plot. The last x tick sits 8px from the svg edge and its label was centred on
// it, so a four-digit label spilled past the viewBox. envi-nir-stack carries
// 900/1000/1100 nm, which puts a four-digit label on the last tick; the oracle
// is geometry, not presence: the "1100" label's bounding box must end inside
// the plot's bounding box (a clipped label still exists in the DOM, so a
// presence check would pass vacuously).

const PANEL = 1;
const LAST_WAVELENGTH_LABEL = String(enviNirStack.wavelengths[enviNirStack.wavelengths.length - 1]);
const DIMENSIONS = { width: enviNirStack.width, height: enviNirStack.height };
const EDGE_TOLERANCE_PX = 0.5;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, enviNirStack.headerFileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("the last wavelength tick label stays inside the Spectra plot", async () => {
  await test.step("pin a pixel spectrum so the wavelength axis renders", async () => {
    await pinPixelSpectrum(launched.window, PANEL, 0, 0, DIMENSIONS);
  });

  await test.step(`the ${LAST_WAVELENGTH_LABEL} nm tick label is on the axis`, async () => {
    await expect
      .poll(() => readSpectraPlotAxisLabels(launched.window))
      .toContain(LAST_WAVELENGTH_LABEL);
  });

  await test.step("its right edge lies within the plot", async () => {
    const plotBox = await requireBoundingBox(spectraPlot(launched.window));
    const label = spectraPlot(launched.window)
      .locator("text")
      .filter({ hasText: new RegExp(`^${LAST_WAVELENGTH_LABEL}$`) })
      .last();
    const labelBox = await requireBoundingBox(label);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(
      plotBox.x + plotBox.width + EDGE_TOLERANCE_PX,
    );
    expect(labelBox.x).toBeGreaterThanOrEqual(plotBox.x - EDGE_TOLERANCE_PX);
  });
});

async function requireBoundingBox(
  locator: ReturnType<typeof spectraPlot>,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected the element to have a bounding box");
  return box;
}
