import { expect, test } from "@playwright/test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "@playwright/test";

import { multiBandTiff, rgbPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import {
  clickGridBackgroundToClearSelection,
  createTemporaryExportDirectory,
  exportSelectedStackAsPngStackToFolder,
  exportSelectedStackThroughSaveDialog,
  loadFixtureAsStack,
  selectGridLayout,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-339: PNG (8-bit) and the PNG stack export write a single-band source as
// a ONE-CHANNEL grayscale file, not an RGB file with three identical
// channels. sharp is the reference decoder oracle: it reports the true
// channel count and sample depth of the file on disk, independent of this
// app's own decode path.

test("a scientific stack's band saves as a one-channel 8-bit PNG", async () => {
  const launched = await launchToolboxApp();
  try {
    await selectGridLayout(launched.window, "1x2");
    await clickGridBackgroundToClearSelection(launched.window);
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    const exportPath = join(await createTemporaryExportDirectory(), "band-grayscale.png");
    await exportSelectedStackThroughSaveDialog({
      app: launched.app,
      page: launched.window,
      formatLabel: "PNG (8-bit)",
      destinationPath: exportPath,
    });
    await expectExportedPngHasOneChannel(launched.window, exportPath);
  } finally {
    await closeToolboxApp(launched);
  }
});

test("a colour photo still saves as a three-channel 8-bit PNG", async () => {
  const launched = await launchToolboxApp();
  try {
    await selectGridLayout(launched.window, "1x2");
    await clickGridBackgroundToClearSelection(launched.window);
    await loadFixtureAsStack(launched.window, rgbPng.fileName);
    const exportPath = join(await createTemporaryExportDirectory(), "photo.png");
    await exportSelectedStackThroughSaveDialog({
      app: launched.app,
      page: launched.window,
      formatLabel: "PNG (8-bit)",
      destinationPath: exportPath,
    });
    await expectExportedPngHasThreeChannels(launched.window, exportPath);
  } finally {
    await closeToolboxApp(launched);
  }
});

test("a PNG stack export writes every band as a one-channel 8-bit PNG", async () => {
  const launched = await launchToolboxApp();
  try {
    await selectGridLayout(launched.window, "1x2");
    await clickGridBackgroundToClearSelection(launched.window);
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
    const destinationFolder = await createTemporaryExportDirectory();
    await exportSelectedStackAsPngStackToFolder({
      app: launched.app,
      page: launched.window,
      formatLabel: "PNG stack (8-bit, one file per band)",
      destinationFolder,
    });
    await expectEveryBandFileHasOneChannel(launched.window, destinationFolder);
  } finally {
    await closeToolboxApp(launched);
  }
});

// metadata() reports the file's OWN colour type without sharp's default
// colour-management pipeline reinterpreting it (unlike .raw(), which widens a
// one-channel PNG to a 3-channel buffer unless a colourspace is forced).
async function expectExportedPngHasOneChannel(
  window: Page,
  exportPath: string,
): Promise<void> {
  await runAsStoryboardStep(window, "Reference-decode the exported band PNG", async () => {
    const metadata = await sharp(exportPath).metadata();
    expect(metadata.channels).toBe(1);
    expect(metadata.depth).toBe("uchar");
    expect(metadata.width).toBe(multiBandTiff.width);
    expect(metadata.height).toBe(multiBandTiff.height);
  });
}

// The RGBA canvas path (unchanged by CT-339) keeps an opaque alpha channel;
// removeAlpha isolates the three colour channels, matching the ct296 pattern.
async function expectExportedPngHasThreeChannels(
  window: Page,
  exportPath: string,
): Promise<void> {
  await runAsStoryboardStep(window, "Reference-decode the exported photo PNG", async () => {
    const { info } = await sharp(exportPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
  });
}

async function expectEveryBandFileHasOneChannel(
  window: Page,
  destinationFolder: string,
): Promise<void> {
  await runAsStoryboardStep(window, "Reference-decode every exported band PNG file", async () => {
    const fileNames = (await readdir(destinationFolder)).filter((name) => name.endsWith(".png"));
    expect(fileNames.length).toBe(multiBandTiff.bandCount);
    for (const fileName of fileNames) {
      const metadata = await sharp(join(destinationFolder, fileName)).metadata();
      expect(metadata.channels).toBe(1);
    }
  });
}
