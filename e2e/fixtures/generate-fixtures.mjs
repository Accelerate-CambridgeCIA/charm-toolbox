// Deterministic E2E fixture generator (CT-114).
//
// Run with: pnpm e2e:fixtures (or `node e2e/fixtures/generate-fixtures.mjs`).
// It rewrites the committed fixtures byte-for-byte on every run (no clocks, no
// randomness), so the suite can assert EXACT pixel readouts and band means.
//
// Every fixture below is tiny (kilobytes) and math-predictable. The expected
// values are derived from the same formulas that fill the pixels and are
// written to manifest.json so specs assert against documented numbers rather
// than magic constants. Do NOT depend on the large captures in test-images/.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import yazl from "yazl";

const FIXTURES_DIRECTORY = dirname(fileURLToPath(import.meta.url));

async function generateAllFixtures() {
  const fixtures = await buildAllFixturesIncludingTheMaskCategoriesZip();
  writeAllFixtureFiles(fixtures);
  const builtinScriptReferences = computeBuiltinScriptReferenceOutputs(fixtures);
  writeManifestFile(fixtures, builtinScriptReferences);
}

// The mask categories zip is built with yazl, whose writer is a stream, so it
// is the one fixture that cannot be produced synchronously.
async function buildAllFixturesIncludingTheMaskCategoriesZip() {
  const fixtures = buildAllFixtures();
  return {
    ...fixtures,
    maskMultibandCategoriesZip: await buildMaskCategoriesZipFixture(fixtures.maskMultibandPng),
  };
}

function buildAllFixtures() {
  return {
    lowContrastGrayPng: buildLowContrastGrayscalePngFixture(),
    bimodalGrayPng: buildBimodalGrayscalePngFixture(),
    noisyGrayPng: buildNoisyGrayscalePngFixture(),
    rgbPng: buildKnownRgbPngFixture(),
    multiBandTiff: buildMultiBandTwelveBitTiffFixture(),
    flatFieldReferenceTiff: buildSingleBandReferenceTiffFixture(),
    rgbaTiff: buildRgbaAlphaTiffFixture(),
    paletteColorTiff: buildPaletteColorTiffFixture(),
    untaggedRgbTiff: buildUntaggedRgbTiffFixture(),
    enviStack: buildEnviStackFixture(),
    enviNirStack: buildEnviNirStackFixture(),
    enviFloatStack: buildEnviFloatStackFixture(),
    maskMultibandPng: buildMaskForMultiBandStackFixture(),
    maskEightBySquarePng: buildMismatchedMaskFixture(),
    maskBinary1BitPng: buildOneBitMaskFixture(),
    maskBinary255Png: buildEightBitBinaryMaskFixture(),
    maskBinaryBottom255Png: buildEightBitBottomRowMaskFixture(),
    parityStackTiff: buildParityStackTiffFixture(),
  };
}

function writeAllFixtureFiles(fixtures) {
  writeFixtureFile(fixtures.lowContrastGrayPng.fileName, fixtures.lowContrastGrayPng.bytes);
  writeFixtureFile(fixtures.bimodalGrayPng.fileName, fixtures.bimodalGrayPng.bytes);
  writeFixtureFile(fixtures.noisyGrayPng.fileName, fixtures.noisyGrayPng.bytes);
  writeFixtureFile(fixtures.rgbPng.fileName, fixtures.rgbPng.bytes);
  writeFixtureFile(fixtures.multiBandTiff.fileName, fixtures.multiBandTiff.bytes);
  writeFixtureFile(fixtures.flatFieldReferenceTiff.fileName, fixtures.flatFieldReferenceTiff.bytes);
  writeFixtureFile(fixtures.rgbaTiff.fileName, fixtures.rgbaTiff.bytes);
  writeFixtureFile(fixtures.paletteColorTiff.fileName, fixtures.paletteColorTiff.bytes);
  writeFixtureFile(fixtures.untaggedRgbTiff.fileName, fixtures.untaggedRgbTiff.bytes);
  writeFixtureFile(fixtures.enviStack.headerFileName, fixtures.enviStack.headerBytes);
  writeFixtureFile(fixtures.enviStack.binaryFileName, fixtures.enviStack.binaryBytes);
  writeFixtureFile(fixtures.enviNirStack.headerFileName, fixtures.enviNirStack.headerBytes);
  writeFixtureFile(fixtures.enviNirStack.binaryFileName, fixtures.enviNirStack.binaryBytes);
  writeFixtureFile(fixtures.enviFloatStack.headerFileName, fixtures.enviFloatStack.headerBytes);
  writeFixtureFile(fixtures.enviFloatStack.binaryFileName, fixtures.enviFloatStack.binaryBytes);
  writeFixtureFile(fixtures.maskMultibandPng.fileName, fixtures.maskMultibandPng.bytes);
  writeFixtureFile(
    fixtures.maskMultibandPng.sidecarFileName,
    fixtures.maskMultibandPng.sidecarBytes,
  );
  writeFixtureFile(fixtures.maskEightBySquarePng.fileName, fixtures.maskEightBySquarePng.bytes);
  writeFixtureFile(fixtures.maskBinary1BitPng.fileName, fixtures.maskBinary1BitPng.bytes);
  writeFixtureFile(fixtures.maskBinary255Png.fileName, fixtures.maskBinary255Png.bytes);
  writeFixtureFile(
    fixtures.maskBinaryBottom255Png.fileName,
    fixtures.maskBinaryBottom255Png.bytes,
  );
  writeFixtureFile(
    fixtures.maskMultibandCategoriesZip.fileName,
    fixtures.maskMultibandCategoriesZip.bytes,
  );
  writeFixtureFile(fixtures.parityStackTiff.fileName, fixtures.parityStackTiff.bytes);
}

function writeFixtureFile(fileName, bytes) {
  writeFileSync(join(FIXTURES_DIRECTORY, fileName), bytes);
  process.stdout.write(`wrote ${fileName} (${bytes.length} bytes)\n`);
}

function writeManifestFile(fixtures, builtinScriptReferences) {
  const manifest = buildFixtureManifest(fixtures, builtinScriptReferences);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(FIXTURES_DIRECTORY, "manifest.json"), text);
  process.stdout.write("wrote manifest.json\n");
}

// --- Low-contrast 8-bit grayscale PNG ---------------------------------------
// 4x4, value(index) = 100 + index*2, index = y*4 + x, so 100..130 (range 30 of
// 255). Useful for the Normalized-viewing stretch and normalize-to-float tests.

const GRAY_FIXTURE_WIDTH = 4;
const GRAY_FIXTURE_HEIGHT = 4;

function buildLowContrastGrayscalePngFixture() {
  const samples = buildLowContrastGraySamples();
  return {
    fileName: "low-contrast-gray.png",
    width: GRAY_FIXTURE_WIDTH,
    height: GRAY_FIXTURE_HEIGHT,
    samples,
    bytes: encodeGrayscalePngBytes(GRAY_FIXTURE_WIDTH, GRAY_FIXTURE_HEIGHT, samples),
  };
}

function buildLowContrastGraySamples() {
  const samples = new Uint8Array(GRAY_FIXTURE_WIDTH * GRAY_FIXTURE_HEIGHT);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 100 + index * 2;
  }
  return samples;
}

// --- Bimodal 8-bit grayscale PNG (CT-201) ------------------------------------
// 4x4, index = y*4 + x. The first 8 pixels form a dark cluster 40..54 (step 2),
// the last 8 a bright cluster 200..214 (step 2), leaving a known empty valley
// 55..199. Otsu (256 one-wide bins over the uint8 type range, first maximizing
// split kept on ties) therefore lands the cutoff at 55, the value just above
// the dark cluster; the manifest pins that expected cutoff. No randomness.

const BIMODAL_FIXTURE_WIDTH = 4;
const BIMODAL_FIXTURE_HEIGHT = 4;
const BIMODAL_DARK_BASE = 40;
const BIMODAL_BRIGHT_BASE = 200;
const BIMODAL_VALUE_STEP = 2;
const BIMODAL_DARK_PIXEL_COUNT = 8;

function buildBimodalGrayscalePngFixture() {
  const samples = buildBimodalGraySamples();
  return {
    fileName: "bimodal-gray.png",
    width: BIMODAL_FIXTURE_WIDTH,
    height: BIMODAL_FIXTURE_HEIGHT,
    samples,
    expectedOtsuCutoff: computeExpectedOtsuCutoffForUint8Samples(samples),
    bytes: encodeGrayscalePngBytes(BIMODAL_FIXTURE_WIDTH, BIMODAL_FIXTURE_HEIGHT, samples),
  };
}

function buildBimodalGraySamples() {
  const samples = new Uint8Array(BIMODAL_FIXTURE_WIDTH * BIMODAL_FIXTURE_HEIGHT);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index < BIMODAL_DARK_PIXEL_COUNT
      ? BIMODAL_DARK_BASE + index * BIMODAL_VALUE_STEP
      : BIMODAL_BRIGHT_BASE + (index - BIMODAL_DARK_PIXEL_COUNT) * BIMODAL_VALUE_STEP;
  }
  return samples;
}

// Mirrors src/renderer/src/lib/image/threshold/otsu.ts for a uint8 band: 256
// one-wide bins, between-class variance maximization, first maximizing split
// kept, cutoff = the lower edge of the first foreground bin (split + 1).
function computeExpectedOtsuCutoffForUint8Samples(samples) {
  const bins = new Uint32Array(256);
  for (const value of samples) bins[value] += 1;
  let totalCount = 0;
  let totalSum = 0;
  for (let bin = 0; bin < bins.length; bin += 1) {
    totalCount += bins[bin];
    totalSum += bin * bins[bin];
  }
  let bestSplit = null;
  let bestVariance = 0;
  let count0 = 0;
  let sum0 = 0;
  for (let split = 0; split < bins.length - 1; split += 1) {
    count0 += bins[split];
    sum0 += split * bins[split];
    const count1 = totalCount - count0;
    if (count0 === 0 || count1 === 0) continue;
    const meanDifference = sum0 / count0 - (totalSum - sum0) / count1;
    const variance = count0 * count1 * meanDifference * meanDifference;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestSplit = split;
    }
  }
  if (bestSplit === null) throw new Error("bimodal fixture must have a valid Otsu split");
  return bestSplit + 1;
}

// --- Noisy 8-bit grayscale PNG (CT-204) ---------------------------------------
// 8x8, smooth base value(x, y) = 100 + 2x + 2y (range 100..128) with two FIXED
// salt-and-pepper spikes at known interior coordinates: (2,2) -> 255 (salt)
// and (5,5) -> 0 (pepper). No randomness. The manifest pins, per spike, the
// noisy (pre) value, the smooth base value, and the radius-1 median-denoised
// (post) value computed by mirroring
// src/renderer/src/lib/image/filters/denoise.ts (clamped square neighborhood,
// exact middle of the sorted 3x3 window).

const NOISY_FIXTURE_WIDTH = 8;
const NOISY_FIXTURE_HEIGHT = 8;
const NOISY_BASE_VALUE = 100;
const NOISY_BASE_STEP = 2;
const NOISY_SPIKE_COORDINATES = [
  { x: 2, y: 2, noisyValue: 255 },
  { x: 5, y: 5, noisyValue: 0 },
];

function buildNoisyGrayscalePngFixture() {
  const samples = buildNoisyGraySamples();
  return {
    fileName: "noisy-gray.png",
    width: NOISY_FIXTURE_WIDTH,
    height: NOISY_FIXTURE_HEIGHT,
    samples,
    spikes: NOISY_SPIKE_COORDINATES.map((spike) => describeNoisySpike(samples, spike)),
    bytes: encodeGrayscalePngBytes(NOISY_FIXTURE_WIDTH, NOISY_FIXTURE_HEIGHT, samples),
  };
}

function computeSmoothNoisyBaseValue(x, y) {
  return NOISY_BASE_VALUE + NOISY_BASE_STEP * x + NOISY_BASE_STEP * y;
}

function buildNoisyGraySamples() {
  const samples = new Uint8Array(NOISY_FIXTURE_WIDTH * NOISY_FIXTURE_HEIGHT);
  for (let y = 0; y < NOISY_FIXTURE_HEIGHT; y += 1) {
    for (let x = 0; x < NOISY_FIXTURE_WIDTH; x += 1) {
      samples[y * NOISY_FIXTURE_WIDTH + x] = computeSmoothNoisyBaseValue(x, y);
    }
  }
  for (const spike of NOISY_SPIKE_COORDINATES) {
    samples[spike.y * NOISY_FIXTURE_WIDTH + spike.x] = spike.noisyValue;
  }
  return samples;
}

function describeNoisySpike(samples, spike) {
  return {
    x: spike.x,
    y: spike.y,
    noisyValue: spike.noisyValue,
    smoothValue: computeSmoothNoisyBaseValue(spike.x, spike.y),
    medianDenoisedValue: computeRadiusOneMedianAt(samples, spike.x, spike.y),
  };
}

// Mirrors applyMedianDenoise for radius 1: coordinates clamp to the band's
// edges, the window is the full 3x3 square, and the median is its exact middle.
function computeRadiusOneMedianAt(samples, centerX, centerY) {
  const window = [];
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    const y = Math.min(Math.max(centerY + offsetY, 0), NOISY_FIXTURE_HEIGHT - 1);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const x = Math.min(Math.max(centerX + offsetX, 0), NOISY_FIXTURE_WIDTH - 1);
      window.push(samples[y * NOISY_FIXTURE_WIDTH + x]);
    }
  }
  window.sort((a, b) => a - b);
  return window[(window.length - 1) / 2];
}

// --- 8-bit RGB PNG with known per-pixel R/G/B -------------------------------
// 2x2 with deliberately distinct channels so grayscale conversion and
// false-colour mapping can be checked against exact channel numbers.

const RGB_FIXTURE_WIDTH = 2;
const RGB_FIXTURE_HEIGHT = 2;

const RGB_FIXTURE_PIXELS = [
  { x: 0, y: 0, r: 200, g: 100, b: 50 },
  { x: 1, y: 0, r: 10, g: 20, b: 30 },
  { x: 0, y: 1, r: 255, g: 0, b: 0 },
  { x: 1, y: 1, r: 0, g: 255, b: 0 },
];

function buildKnownRgbPngFixture() {
  const samples = buildKnownRgbSamples();
  return {
    fileName: "rgb.png",
    width: RGB_FIXTURE_WIDTH,
    height: RGB_FIXTURE_HEIGHT,
    pixels: RGB_FIXTURE_PIXELS,
    bytes: encodeRgbPngBytes(RGB_FIXTURE_WIDTH, RGB_FIXTURE_HEIGHT, samples),
  };
}

function buildKnownRgbSamples() {
  const samples = new Uint8Array(RGB_FIXTURE_WIDTH * RGB_FIXTURE_HEIGHT * 3);
  for (const pixel of RGB_FIXTURE_PIXELS) {
    const base = (pixel.y * RGB_FIXTURE_WIDTH + pixel.x) * 3;
    samples[base] = pixel.r;
    samples[base + 1] = pixel.g;
    samples[base + 2] = pixel.b;
  }
  return samples;
}

// --- Multi-band 12-bit-in-16-bit TIFF stack ---------------------------------
// 4x4, 3 pages (bands), uint16 container holding 12-bit values (<= 4095).
// value(band, index) = bandBase[band] + index*10, index = y*4 + x. The per-band
// bases give distinct means; the per-pixel ramp lets specs read true values at
// known coordinates (and bit-shift-by-4 multiplies each by 16, staying < 4096*16).

const STACK_WIDTH = 4;
const STACK_HEIGHT = 4;
const STACK_BAND_BASES = [100, 800, 1600];
const STACK_VALUE_STEP = 10;

function buildMultiBandTwelveBitTiffFixture() {
  const bands = STACK_BAND_BASES.map(buildRampBandFromBase);
  return {
    fileName: "multiband-12bit.tif",
    width: STACK_WIDTH,
    height: STACK_HEIGHT,
    bands,
    bytes: encodeMultiPageUint16TiffBytes(STACK_WIDTH, STACK_HEIGHT, bands),
  };
}

function buildRampBandFromBase(base) {
  const band = new Uint16Array(STACK_WIDTH * STACK_HEIGHT);
  for (let index = 0; index < band.length; index += 1) {
    band[index] = base + index * STACK_VALUE_STEP;
  }
  return band;
}

// --- Same-size single-band reference TIFF for flat-field broadcast ----------
// 4x4 (matches the stack), uniform 1000 so it can be broadcast across all
// bands without introducing a zero divisor in the flat-field formula.

const FLAT_FIELD_REFERENCE_VALUE = 1000;

function buildSingleBandReferenceTiffFixture() {
  const band = new Uint16Array(STACK_WIDTH * STACK_HEIGHT).fill(FLAT_FIELD_REFERENCE_VALUE);
  return {
    fileName: "flat-field-reference.tif",
    width: STACK_WIDTH,
    height: STACK_HEIGHT,
    bands: [band],
    bytes: encodeMultiPageUint16TiffBytes(STACK_WIDTH, STACK_HEIGHT, [band]),
  };
}

// --- Colour TIFF variants (CT-288) ------------------------------------------
// Three synthetic single-page TIFFs exercising the broadened colour detection in
// load-tiff.ts. All reuse the rgb.png pixel colours ((0,0)=(200,100,50) etc.) so
// the same documented RGB numbers hold across every colour fixture:
//   rgba.tif         - photometric RGB, 4 samples per pixel, ExtraSamples marks
//                      the 4th as unassociated alpha; the loader drops alpha.
//   palette-color.tif - photometric Palette, uint8 indices 0..3 with a 256-entry
//                      colormap holding value*257 per channel, so the loader's
//                      top-byte expansion (>> 8) recovers the exact 8-bit colours.
//   rgb-untagged.tif  - 3 samples per pixel with NO photometric tag; treated as RGB.

const COLOR_VARIANT_WIDTH = 2;
const COLOR_VARIANT_HEIGHT = 2;
const COLOR_VARIANT_ALPHAS = [255, 128, 64, 0];
const PALETTE_ENTRY_COUNT = 256;
const PALETTE_CHANNEL_SCALE = 257;
const TIFF_EXTRA_SAMPLE_UNASSOCIATED_ALPHA = 2;

function buildRgbaAlphaTiffFixture() {
  return {
    fileName: "rgba.tif",
    width: COLOR_VARIANT_WIDTH,
    height: COLOR_VARIANT_HEIGHT,
    pixels: RGB_FIXTURE_PIXELS,
    bytes: encodeSinglePageUint8TiffBytes(buildRgbaTiffEntries(), buildInterleavedRgbaStrip()),
  };
}

function buildRgbaTiffEntries() {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_WIDTH] },
    { tag: 257, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_HEIGHT] },
    { tag: 258, type: TIFF_TYPE_SHORT, values: [8, 8, 8, 8] },
    { tag: 259, type: TIFF_TYPE_SHORT, values: [1] },
    { tag: 262, type: TIFF_TYPE_SHORT, values: [2] },
    { tag: 273, type: TIFF_TYPE_LONG, values: [0] },
    { tag: 277, type: TIFF_TYPE_SHORT, values: [4] },
    { tag: 278, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_HEIGHT] },
    { tag: 279, type: TIFF_TYPE_LONG, values: [COLOR_VARIANT_WIDTH * COLOR_VARIANT_HEIGHT * 4] },
    { tag: 338, type: TIFF_TYPE_SHORT, values: [TIFF_EXTRA_SAMPLE_UNASSOCIATED_ALPHA] },
  ];
}

function buildInterleavedRgbaStrip() {
  const strip = new Uint8Array(COLOR_VARIANT_WIDTH * COLOR_VARIANT_HEIGHT * 4);
  RGB_FIXTURE_PIXELS.forEach((pixel, pixelIndex) => {
    const base = (pixel.y * COLOR_VARIANT_WIDTH + pixel.x) * 4;
    strip[base] = pixel.r;
    strip[base + 1] = pixel.g;
    strip[base + 2] = pixel.b;
    strip[base + 3] = COLOR_VARIANT_ALPHAS[pixelIndex];
  });
  return strip;
}

function buildPaletteColorTiffFixture() {
  return {
    fileName: "palette-color.tif",
    width: COLOR_VARIANT_WIDTH,
    height: COLOR_VARIANT_HEIGHT,
    pixels: RGB_FIXTURE_PIXELS,
    bytes: encodeSinglePageUint8TiffBytes(buildPaletteTiffEntries(), buildPaletteIndexStrip()),
  };
}

function buildPaletteTiffEntries() {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_WIDTH] },
    { tag: 257, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_HEIGHT] },
    { tag: 258, type: TIFF_TYPE_SHORT, values: [8] },
    { tag: 259, type: TIFF_TYPE_SHORT, values: [1] },
    { tag: 262, type: TIFF_TYPE_SHORT, values: [3] },
    { tag: 273, type: TIFF_TYPE_LONG, values: [0] },
    { tag: 277, type: TIFF_TYPE_SHORT, values: [1] },
    { tag: 278, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_HEIGHT] },
    { tag: 279, type: TIFF_TYPE_LONG, values: [COLOR_VARIANT_WIDTH * COLOR_VARIANT_HEIGHT] },
    { tag: 320, type: TIFF_TYPE_SHORT, values: buildPaletteColorMapValues() },
  ];
}

// Pixel (x, y) uses palette index y*width + x, whose colormap entry holds that
// pixel's rgb.png colour scaled by 257 (so value >> 8 gives the colour back).
function buildPaletteIndexStrip() {
  const strip = new Uint8Array(COLOR_VARIANT_WIDTH * COLOR_VARIANT_HEIGHT);
  for (let index = 0; index < strip.length; index += 1) strip[index] = index;
  return strip;
}

function buildPaletteColorMapValues() {
  const values = new Array(PALETTE_ENTRY_COUNT * 3).fill(0);
  RGB_FIXTURE_PIXELS.forEach((pixel, entryIndex) => {
    values[entryIndex] = pixel.r * PALETTE_CHANNEL_SCALE;
    values[PALETTE_ENTRY_COUNT + entryIndex] = pixel.g * PALETTE_CHANNEL_SCALE;
    values[PALETTE_ENTRY_COUNT * 2 + entryIndex] = pixel.b * PALETTE_CHANNEL_SCALE;
  });
  return values;
}

function buildUntaggedRgbTiffFixture() {
  return {
    fileName: "rgb-untagged.tif",
    width: COLOR_VARIANT_WIDTH,
    height: COLOR_VARIANT_HEIGHT,
    pixels: RGB_FIXTURE_PIXELS,
    bytes: encodeSinglePageUint8TiffBytes(buildUntaggedRgbTiffEntries(), buildKnownRgbSamples()),
  };
}

function buildUntaggedRgbTiffEntries() {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_WIDTH] },
    { tag: 257, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_HEIGHT] },
    { tag: 258, type: TIFF_TYPE_SHORT, values: [8, 8, 8] },
    { tag: 259, type: TIFF_TYPE_SHORT, values: [1] },
    { tag: 273, type: TIFF_TYPE_LONG, values: [0] },
    { tag: 277, type: TIFF_TYPE_SHORT, values: [3] },
    { tag: 278, type: TIFF_TYPE_SHORT, values: [COLOR_VARIANT_HEIGHT] },
    { tag: 279, type: TIFF_TYPE_LONG, values: [COLOR_VARIANT_WIDTH * COLOR_VARIANT_HEIGHT * 3] },
  ];
}

// --- Single-page TIFF encoder with multi-value tag support -------------------
// Unlike the multi-page uint16 encoder below, these variants need tag values
// that exceed the 4 inline bytes (BitsPerSample per channel, the colormap), so
// oversized values are stored after the IFD and referenced by offset. The
// StripOffsets entry (tag 273) is patched to the computed strip position.

function encodeSinglePageUint8TiffBytes(entries, stripBytes) {
  const layout = computeSinglePageTiffLayout(entries, stripBytes.length);
  const view = new DataView(new ArrayBuffer(layout.totalSize));
  writeLittleEndianTiffHeader(view);
  writeSinglePageIfd(view, entries, layout);
  writeExternalEntryValues(view, entries, layout);
  new Uint8Array(view.buffer).set(stripBytes, layout.stripOffset);
  return new Uint8Array(view.buffer);
}

function computeSinglePageTiffLayout(entries, stripByteCount) {
  const ifdByteSize = 2 + entries.length * 12 + 4;
  let externalCursor = TIFF_FIRST_IFD_OFFSET + ifdByteSize;
  const externalOffsets = new Map();
  for (const entry of entries) {
    if (entryValueByteSize(entry) <= 4) continue;
    externalOffsets.set(entry.tag, externalCursor);
    externalCursor += entryValueByteSize(entry);
  }
  return { externalOffsets, stripOffset: externalCursor, totalSize: externalCursor + stripByteCount };
}

function entryValueByteSize(entry) {
  const bytesPerValue = entry.type === TIFF_TYPE_SHORT ? 2 : 4;
  return entry.values.length * bytesPerValue;
}

function writeSinglePageIfd(view, entries, layout) {
  view.setUint16(TIFF_FIRST_IFD_OFFSET, entries.length, true);
  entries.forEach((entry, entryIndex) => {
    const entryOffset = TIFF_FIRST_IFD_OFFSET + 2 + entryIndex * 12;
    writeSinglePageIfdEntry(view, entryOffset, resolveEntryForLayout(entry, layout), layout);
  });
  view.setUint32(TIFF_FIRST_IFD_OFFSET + 2 + entries.length * 12, 0, true);
}

function resolveEntryForLayout(entry, layout) {
  if (entry.tag !== 273) return entry;
  return { ...entry, values: [layout.stripOffset] };
}

function writeSinglePageIfdEntry(view, entryOffset, entry, layout) {
  view.setUint16(entryOffset, entry.tag, true);
  view.setUint16(entryOffset + 2, entry.type, true);
  view.setUint32(entryOffset + 4, entry.values.length, true);
  const externalOffset = layout.externalOffsets.get(entry.tag);
  if (externalOffset === undefined) {
    writeInlineEntryValues(view, entryOffset + 8, entry);
    return;
  }
  view.setUint32(entryOffset + 8, externalOffset, true);
}

function writeInlineEntryValues(view, valueOffset, entry) {
  entry.values.forEach((value, valueIndex) => {
    if (entry.type === TIFF_TYPE_SHORT) view.setUint16(valueOffset + valueIndex * 2, value, true);
    else view.setUint32(valueOffset + valueIndex * 4, value, true);
  });
}

function writeExternalEntryValues(view, entries, layout) {
  for (const entry of entries) {
    const externalOffset = layout.externalOffsets.get(entry.tag);
    if (externalOffset === undefined) continue;
    entry.values.forEach((value, valueIndex) => {
      view.setUint16(externalOffset + valueIndex * 2, value, true);
    });
  }
}

// --- Single-file ENVI stack (.hdr + binary) with wavelengths ----------------
// 4x4, 3 bands, uint16 (data type 12), BSQ, little-endian, with wavelength
// metadata. value(band, index) = enviBase[band] + index, distinct band means.

const ENVI_WIDTH = 4;
const ENVI_HEIGHT = 4;
const ENVI_BAND_BASES = [200, 1000, 1800];
const ENVI_WAVELENGTHS = [450, 550, 650];
// CT-351: four-digit wavelengths, so the last spectra x tick label is wide
// enough to spill past the plot edge unless it is anchored inside.
const ENVI_NIR_WAVELENGTHS = [900, 1000, 1100];
const ENVI_DATA_TYPE_UINT16 = 12;

function buildEnviStackFixture() {
  return buildEnviUint16StackFixture("envi-stack", ENVI_WAVELENGTHS);
}

function buildEnviNirStackFixture() {
  return buildEnviUint16StackFixture("envi-nir-stack", ENVI_NIR_WAVELENGTHS);
}

function buildEnviUint16StackFixture(fileBaseName, wavelengths) {
  const bands = ENVI_BAND_BASES.map(buildEnviRampBandFromBase);
  return {
    headerFileName: `${fileBaseName}.hdr`,
    binaryFileName: `${fileBaseName}.bin`,
    width: ENVI_WIDTH,
    height: ENVI_HEIGHT,
    bands,
    wavelengths,
    headerBytes: encodeEnviHeaderBytes(wavelengths),
    binaryBytes: encodeEnviBandSequentialUint16Binary(bands),
  };
}

function buildEnviRampBandFromBase(base) {
  const band = new Uint16Array(ENVI_WIDTH * ENVI_HEIGHT);
  for (let index = 0; index < band.length; index += 1) {
    band[index] = base + index;
  }
  return band;
}

function encodeEnviHeaderBytes(wavelengths) {
  const lines = [
    "ENVI",
    `samples = ${ENVI_WIDTH}`,
    `lines = ${ENVI_HEIGHT}`,
    `bands = ${ENVI_BAND_BASES.length}`,
    "header offset = 0",
    "file type = ENVI Standard",
    `data type = ${ENVI_DATA_TYPE_UINT16}`,
    "interleave = bsq",
    "byte order = 0",
    `wavelength = { ${wavelengths.join(", ")} }`,
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf-8");
}

function encodeEnviBandSequentialUint16Binary(bands) {
  const samplesPerBand = ENVI_WIDTH * ENVI_HEIGHT;
  const buffer = Buffer.alloc(bands.length * samplesPerBand * 2);
  bands.forEach((band, bandIndex) => {
    writeBandSequentialUint16Run(buffer, band, bandIndex * samplesPerBand * 2);
  });
  return buffer;
}

function writeBandSequentialUint16Run(buffer, band, baseByteOffset) {
  for (let index = 0; index < band.length; index += 1) {
    buffer.writeUInt16LE(band[index], baseByteOffset + index * 2);
  }
}

// --- Single-file ENVI float32 stack (.hdr + binary), values straddling [0,1] --
// CT-198: 4x4, 3 bands, float32 (data type 4), BSQ, little-endian. Band 0 is a
// mostly-negative field (-1.0) with four bright (+1.5) pixels in the centre, so its
// extents straddle [0,1] (some < 0, some > 1). Opening the Tone Curve panel on a float
// band must NOT restretch it: with the float default-identity fix the negatives stay
// black and only the four bright pixels light up, exactly as before the panel opened.

const ENVI_FLOAT_WIDTH = 4;
const ENVI_FLOAT_HEIGHT = 4;
const ENVI_FLOAT_DATA_TYPE = 4;
const ENVI_FLOAT_WAVELENGTHS = [500, 600, 700];
const ENVI_FLOAT_DARK_VALUE = -1.0;
const ENVI_FLOAT_BRIGHT_VALUE = 1.5;
const ENVI_FLOAT_BRIGHT_INDICES = [5, 6, 9, 10];

function buildEnviFloatStackFixture() {
  const bands = [buildMostlyDarkFloatBandWithBrightCentre(), buildFloatRampBand(-0.5, 0.12), buildFloatRampBand(-0.8, 0.15)];
  return {
    headerFileName: "envi-float-stack.hdr",
    binaryFileName: "envi-float-stack.bin",
    width: ENVI_FLOAT_WIDTH,
    height: ENVI_FLOAT_HEIGHT,
    bands,
    wavelengths: ENVI_FLOAT_WAVELENGTHS,
    headerBytes: encodeEnviFloatHeaderBytes(),
    binaryBytes: encodeEnviBandSequentialFloat32Binary(bands),
  };
}

function buildMostlyDarkFloatBandWithBrightCentre() {
  const band = new Float32Array(ENVI_FLOAT_WIDTH * ENVI_FLOAT_HEIGHT).fill(ENVI_FLOAT_DARK_VALUE);
  for (const index of ENVI_FLOAT_BRIGHT_INDICES) band[index] = ENVI_FLOAT_BRIGHT_VALUE;
  return band;
}

function buildFloatRampBand(base, step) {
  const band = new Float32Array(ENVI_FLOAT_WIDTH * ENVI_FLOAT_HEIGHT);
  for (let index = 0; index < band.length; index += 1) band[index] = base + index * step;
  return band;
}

function encodeEnviFloatHeaderBytes() {
  const lines = [
    "ENVI",
    `samples = ${ENVI_FLOAT_WIDTH}`,
    `lines = ${ENVI_FLOAT_HEIGHT}`,
    `bands = ${ENVI_FLOAT_WAVELENGTHS.length}`,
    "header offset = 0",
    "file type = ENVI Standard",
    `data type = ${ENVI_FLOAT_DATA_TYPE}`,
    "interleave = bsq",
    "byte order = 0",
    `wavelength = { ${ENVI_FLOAT_WAVELENGTHS.join(", ")} }`,
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf-8");
}

function encodeEnviBandSequentialFloat32Binary(bands) {
  const samplesPerBand = ENVI_FLOAT_WIDTH * ENVI_FLOAT_HEIGHT;
  const buffer = Buffer.alloc(bands.length * samplesPerBand * 4);
  bands.forEach((band, bandIndex) => {
    writeBandSequentialFloat32Run(buffer, band, bandIndex * samplesPerBand * 4);
  });
  return buffer;
}

function writeBandSequentialFloat32Run(buffer, band, baseByteOffset) {
  for (let index = 0; index < band.length; index += 1) {
    buffer.writeFloatLE(band[index], baseByteOffset + index * 4);
  }
}

// --- Mask fixtures (CT-303) --------------------------------------------------
// A mask PNG stores CATEGORY INDEXES as 8-bit grayscale samples: 0 = unlabeled,
// 1..5 = the 1-based category. mask-multiband.png covers multiband-12bit.tif
// (4x4) with two categories - the top row is category 1, the bottom row is
// category 2, the middle rows are unlabeled - and ships the JSON sidecar that
// names and colours them. mask-8x8.png is the same idea at a size NO fixture
// stack has, so importing it onto the 4x4 stack must be refused.

const MASK_FIXTURE_WIDTH = 4;
const MASK_FIXTURE_HEIGHT = 4;
const MASK_FIXTURE_LAYER_NAME = "Parchment mask";
const MASK_FIXTURE_OPACITY_PERCENT = 60;
const MASK_FIXTURE_CATEGORIES = [
  { index: 1, name: "Parchment", color: "#ef4444" },
  { index: 2, name: "Substrate", color: "#3b82f6" },
];

const MISMATCHED_MASK_FIXTURE_SIZE = 8;

function buildMaskForMultiBandStackFixture() {
  const values = buildTopAndBottomRowMaskValues();
  const sidecar = buildMaskSidecarDocumentText();
  return {
    fileName: "mask-multiband.png",
    sidecarFileName: "mask-multiband.json",
    width: MASK_FIXTURE_WIDTH,
    height: MASK_FIXTURE_HEIGHT,
    name: MASK_FIXTURE_LAYER_NAME,
    opacity: MASK_FIXTURE_OPACITY_PERCENT,
    categories: MASK_FIXTURE_CATEGORIES,
    values,
    bytes: encodeGrayscalePngBytes(MASK_FIXTURE_WIDTH, MASK_FIXTURE_HEIGHT, values),
    sidecarBytes: Buffer.from(sidecar, "utf-8"),
  };
}

function buildTopAndBottomRowMaskValues() {
  const values = new Uint8Array(MASK_FIXTURE_WIDTH * MASK_FIXTURE_HEIGHT);
  for (let x = 0; x < MASK_FIXTURE_WIDTH; x += 1) {
    values[x] = 1;
    values[(MASK_FIXTURE_HEIGHT - 1) * MASK_FIXTURE_WIDTH + x] = 2;
  }
  return values;
}

function buildMaskSidecarDocumentText() {
  const document = {
    formatVersion: 1,
    name: MASK_FIXTURE_LAYER_NAME,
    width: MASK_FIXTURE_WIDTH,
    height: MASK_FIXTURE_HEIGHT,
    categories: MASK_FIXTURE_CATEGORIES,
    opacity: MASK_FIXTURE_OPACITY_PERCENT,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildMismatchedMaskFixture() {
  const size = MISMATCHED_MASK_FIXTURE_SIZE;
  const values = new Uint8Array(size * size);
  values[0] = 1;
  values[values.length - 1] = 1;
  return {
    fileName: "mask-8x8.png",
    width: size,
    height: size,
    values,
    bytes: encodeGrayscalePngBytes(size, size, values),
  };
}

// CT-325: two more masks covering multiband-12bit.tif (4x4), each with the
// top row painted and the rest unlabeled, but written at bit depths PIL,
// ImageJ and Photoshop actually emit for a black-and-white mask.
// mask-binary-1bit.png is 1-bit grayscale with white (sample 1) as the top
// row - the raw sample IS a valid category index already. mask-binary-255.png
// is 8-bit grayscale with white (sample 255) as the top row - CT-326 remaps
// 255 down to category 1.

function buildOneBitMaskFixture() {
  const values = buildTopRowMaskValues(1);
  return {
    fileName: "mask-binary-1bit.png",
    width: MASK_FIXTURE_WIDTH,
    height: MASK_FIXTURE_HEIGHT,
    values,
    bytes: encodeGrayscale1BitPngBytes(MASK_FIXTURE_WIDTH, MASK_FIXTURE_HEIGHT, values),
  };
}

function buildEightBitBinaryMaskFixture() {
  const values = buildTopRowMaskValues(255);
  return {
    fileName: "mask-binary-255.png",
    width: MASK_FIXTURE_WIDTH,
    height: MASK_FIXTURE_HEIGHT,
    values,
    bytes: encodeGrayscalePngBytes(MASK_FIXTURE_WIDTH, MASK_FIXTURE_HEIGHT, values),
  };
}

function buildTopRowMaskValues(topRowValue) {
  const values = new Uint8Array(MASK_FIXTURE_WIDTH * MASK_FIXTURE_HEIGHT);
  for (let x = 0; x < MASK_FIXTURE_WIDTH; x += 1) values[x] = topRowValue;
  return values;
}

// CT-328: mask-binary-bottom-255.png is the other half of a two-class
// multi-file import. Picked after mask-binary-1bit.png it becomes category 2
// over the bottom row, which is EXACTLY the layout mask-multiband.png paints,
// so the NPC scores of the combined layer match the pinned npc reference.

function buildEightBitBottomRowMaskFixture() {
  const values = buildBottomRowMaskValues(255);
  return {
    fileName: "mask-binary-bottom-255.png",
    width: MASK_FIXTURE_WIDTH,
    height: MASK_FIXTURE_HEIGHT,
    values,
    bytes: encodeGrayscalePngBytes(MASK_FIXTURE_WIDTH, MASK_FIXTURE_HEIGHT, values),
  };
}

function buildBottomRowMaskValues(bottomRowValue) {
  const values = new Uint8Array(MASK_FIXTURE_WIDTH * MASK_FIXTURE_HEIGHT);
  const firstIndexOfLastRow = (MASK_FIXTURE_HEIGHT - 1) * MASK_FIXTURE_WIDTH;
  for (let x = 0; x < MASK_FIXTURE_WIDTH; x += 1) values[firstIndexOfLastRow + x] = bottomRowValue;
  return values;
}

// CT-328: a mask zip written by a DIFFERENT tool (yazl, so every entry is
// DEFLATED, unlike the app's own STORE-only export). It holds the same four
// files an export does - a black-and-white PNG per category plus the index PNG
// and its sidecar - so importing it must take the LOSSLESS path and rebuild
// mask-multiband.png's layer exactly.

async function buildMaskCategoriesZipFixture(maskFixture) {
  const entries = buildMaskCategoriesZipEntries(maskFixture);
  return {
    fileName: "mask-multiband-categories.zip",
    entryNames: entries.map((entry) => entry.name),
    indexPngEntryName: maskFixture.fileName,
    sidecarEntryName: maskFixture.sidecarFileName,
    bytes: await deflateEntriesIntoZipWithYazl(entries),
  };
}

function buildMaskCategoriesZipEntries(maskFixture) {
  return [
    ...maskFixture.categories.map((category) =>
      buildCategoryBinaryZipEntry(maskFixture, category),
    ),
    { name: maskFixture.fileName, bytes: maskFixture.bytes },
    { name: maskFixture.sidecarFileName, bytes: maskFixture.sidecarBytes },
  ];
}

function buildCategoryBinaryZipEntry(maskFixture, category) {
  const values = Uint8Array.from(maskFixture.values, (value) =>
    value === category.index ? 255 : 0,
  );
  return {
    name: `${category.name}.png`,
    bytes: encodeGrayscalePngBytes(maskFixture.width, maskFixture.height, values),
  };
}

function deflateEntriesIntoZipWithYazl(entries) {
  const archive = new yazl.ZipFile();
  for (const entry of entries) archive.addBuffer(Buffer.from(entry.bytes), entry.name);
  archive.end();
  return collectStreamIntoBuffer(archive.outputStream);
}

function collectStreamIntoBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// --- PNG encoding -----------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_BIT_DEPTH_8 = 8;
const PNG_COLOR_TYPE_GRAYSCALE = 0;
const PNG_COLOR_TYPE_RGB = 2;
const crc32Table = buildCrc32Table();

function encodeGrayscalePngBytes(width, height, samples) {
  const scanlines = buildFilteredScanlines(samples, width);
  return assemblePngBytes(width, height, PNG_COLOR_TYPE_GRAYSCALE, scanlines);
}

function encodeRgbPngBytes(width, height, samples) {
  const scanlines = buildFilteredScanlines(samples, width * 3);
  return assemblePngBytes(width, height, PNG_COLOR_TYPE_RGB, scanlines);
}

const PNG_BIT_DEPTH_1 = 1;

// CT-325: samples are 0/1 values, packed most-significant-bit first, one row
// of ceil(width / 8) bytes per scanline (no filtering needed at this size).
function encodeGrayscale1BitPngBytes(width, height, samples) {
  const scanlines = buildFiltered1BitScanlines(samples, width, height);
  return assemblePngBytes(width, height, PNG_COLOR_TYPE_GRAYSCALE, scanlines, PNG_BIT_DEPTH_1);
}

function buildFiltered1BitScanlines(samples, width, height) {
  const rowByteWidth = Math.ceil(width / 8);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.concat([Buffer.from([0]), packOneBitRow(samples, y * width, width, rowByteWidth)]));
  }
  return Buffer.concat(rows);
}

function packOneBitRow(samples, rowStart, width, rowByteWidth) {
  const packed = Buffer.alloc(rowByteWidth);
  for (let x = 0; x < width; x += 1) {
    if (samples[rowStart + x]) packed[Math.floor(x / 8)] |= 0x80 >> x % 8;
  }
  return packed;
}

function assemblePngBytes(width, height, colorType, rawScanlines, bitDepth = PNG_BIT_DEPTH_8) {
  const header = encodePngChunk("IHDR", buildPngHeaderData(width, height, colorType, bitDepth));
  const data = encodePngChunk("IDAT", deflateSync(rawScanlines));
  const end = encodePngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([PNG_SIGNATURE, header, data, end]);
}

function buildPngHeaderData(width, height, colorType, bitDepth) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  return data;
}

function buildFilteredScanlines(samples, bytesPerRow) {
  const rows = [];
  for (let offset = 0; offset < samples.length; offset += bytesPerRow) {
    rows.push(Buffer.from([0, ...samples.subarray(offset, offset + bytesPerRow)]));
  }
  return Buffer.concat(rows);
}

function encodePngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = buildUint32BigEndianBuffer(data.length);
  const checksum = buildUint32BigEndianBuffer(computeCrc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

function buildUint32BigEndianBuffer(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function computeCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    table[index] = computeCrc32TableEntry(index);
  }
  return table;
}

function computeCrc32TableEntry(byteValue) {
  let remainder = byteValue;
  for (let bit = 0; bit < 8; bit += 1) {
    remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
  }
  return remainder >>> 0;
}

// --- Multi-page uint16 TIFF encoding ----------------------------------------
// One classic little-endian directory (IFD) per band, each followed by its own
// uncompressed strip. The TIFF loader reads each same-shape page as one band.

const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_FIRST_IFD_OFFSET = 8;

function encodeMultiPageUint16TiffBytes(width, height, bands) {
  const stripByteSize = width * height * 2;
  const pageBlockSize = TIFF_IFD_BYTE_SIZE + stripByteSize;
  const view = allocateTiffView(bands.length, pageBlockSize);
  writeLittleEndianTiffHeader(view);
  bands.forEach((band, pageIndex) => {
    writeTiffPage(view, pageIndex, bands.length, pageBlockSize, width, height, band);
  });
  return new Uint8Array(view.buffer);
}

function allocateTiffView(pageCount, pageBlockSize) {
  const totalSize = TIFF_FIRST_IFD_OFFSET + pageCount * pageBlockSize;
  return new DataView(new ArrayBuffer(totalSize));
}

function writeLittleEndianTiffHeader(view) {
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, TIFF_FIRST_IFD_OFFSET, true);
}

function writeTiffPage(view, pageIndex, pageCount, pageBlockSize, width, height, band) {
  const ifdOffset = TIFF_FIRST_IFD_OFFSET + pageIndex * pageBlockSize;
  const stripOffset = ifdOffset + TIFF_IFD_BYTE_SIZE;
  const nextIfdOffset = pageIndex < pageCount - 1 ? ifdOffset + pageBlockSize : 0;
  const entries = buildTiffPageEntries(width, height, stripOffset);
  writeIfdAtOffset(view, ifdOffset, entries, nextIfdOffset);
  writeUint16StripAtOffset(view, stripOffset, band);
}

function buildTiffPageEntries(width, height, stripOffset) {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, value: width },
    { tag: 257, type: TIFF_TYPE_SHORT, value: height },
    { tag: 258, type: TIFF_TYPE_SHORT, value: 16 },
    { tag: 259, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 262, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 273, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: 277, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 278, type: TIFF_TYPE_SHORT, value: height },
    { tag: 279, type: TIFF_TYPE_LONG, value: width * height * 2 },
    { tag: 339, type: TIFF_TYPE_SHORT, value: 1 },
  ];
}

function writeIfdAtOffset(view, ifdOffset, entries, nextIfdOffset) {
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((entry, entryIndex) => {
    writeIfdEntry(view, ifdOffset + 2 + entryIndex * 12, entry);
  });
  view.setUint32(ifdOffset + 2 + entries.length * 12, nextIfdOffset, true);
}

function writeIfdEntry(view, offset, entry) {
  view.setUint16(offset, entry.tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, 1, true);
  writeIfdEntryValue(view, offset + 8, entry);
}

function writeIfdEntryValue(view, offset, entry) {
  if (entry.type === TIFF_TYPE_SHORT) {
    view.setUint16(offset, entry.value, true);
    return;
  }
  view.setUint32(offset, entry.value, true);
}

function writeUint16StripAtOffset(view, offset, band) {
  for (let index = 0; index < band.length; index += 1) {
    view.setUint16(offset + index * 2, band[index], true);
  }
}

// --- Parity stack for Local PCA / Local MNF (CT-307/CT-311/CT-312) -----------
// 16x16, 3 bands, uint16. The 4x4 stacks are too small and too collinear for
// the local PCA/MNF defaults (MNF's noise statistics need genuine per-band
// variation), so this fixture layers deterministic LCG noise over per-band
// gradients. No clocks, no Math.random: identical bytes on every regeneration.

const PARITY_STACK_SIZE = 16;
const PARITY_BAND_BASES = [300, 1200, 2400];
const PARITY_GRADIENT_X_STEP = 8;
const PARITY_GRADIENT_Y_STEP = 5;
const PARITY_NOISE_AMPLITUDE = 120;
const PARITY_NOISE_SEED = 0x53474d31;

function buildParityStackTiffFixture() {
  const nextNoise = createDeterministicNoiseGenerator(PARITY_NOISE_SEED);
  const bands = PARITY_BAND_BASES.map((base) => buildParityBand(base, nextNoise));
  return {
    fileName: "parity-16x16.tif",
    width: PARITY_STACK_SIZE,
    height: PARITY_STACK_SIZE,
    bands,
    bytes: encodeMultiPageUint16TiffBytes(PARITY_STACK_SIZE, PARITY_STACK_SIZE, bands),
  };
}

function buildParityBand(base, nextNoise) {
  const band = new Uint16Array(PARITY_STACK_SIZE * PARITY_STACK_SIZE);
  for (let y = 0; y < PARITY_STACK_SIZE; y += 1) {
    for (let x = 0; x < PARITY_STACK_SIZE; x += 1) {
      const gradient = base + PARITY_GRADIENT_X_STEP * x + PARITY_GRADIENT_Y_STEP * y;
      band[y * PARITY_STACK_SIZE + x] = gradient + Math.round(nextNoise() * PARITY_NOISE_AMPLITUDE);
    }
  }
  return band;
}

// Numerical Recipes LCG; full 32-bit state, values in [0, 1).
function createDeterministicNoiseGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

// --- Built-in script reference runner (CT-307) --------------------------------
// Executes the committed built-in algorithm scripts (resources/builtin-python)
// directly with the bundled Python runtime against the fixtures above and pins
// their outputs into manifest.json: the parity oracle for CT-308 through
// CT-313 (app results must match within 1e-4 relative tolerance). Cube results
// are coerced to float32 exactly as the worker bootstrap does, so the pinned
// values equal what the app delivers.

const REPO_ROOT_DIRECTORY = join(FIXTURES_DIRECTORY, "..", "..");
const BUILTIN_SCRIPTS_DIRECTORY = join(REPO_ROOT_DIRECTORY, "resources", "builtin-python");
const ROP_REFERENCE_SEED = 20260822;
const ROP_SEARCH_REFERENCE_PROJECTION_COUNT = 50;
const ROP_SEARCH_OBJECTIVE_SCRIPT_FILE_NAME = "mask-contrast-objective.py";

// The committed objective fixture the app imports in the CT-310 spec; the
// reference run must score with the SAME source the app sends as a param.
function readObjectiveScriptSource() {
  return readFileSync(join(FIXTURES_DIRECTORY, ROP_SEARCH_OBJECTIVE_SCRIPT_FILE_NAME), "utf8");
}

const REFERENCE_RUNNER_PYTHON_SOURCE = `
import json, sys
import numpy as np
request = json.loads(sys.stdin.read())
sys.path.insert(0, request["directory"])
module = __import__(request["moduleName"])
cube = np.array(request["cube"], dtype=np.float32)
params = dict(request.get("params") or {})
masks = request.get("masks")
if masks is not None:
    params["masks"] = [np.array(mask, dtype=np.uint8) for mask in masks]
params["report_progress"] = lambda fraction: None
value = module.run(cube, request.get("wavelengths"), params)
if isinstance(value, np.ndarray):
    coerced = np.ascontiguousarray(np.asarray(value).astype("<f4", copy=False))
    out = {"kind": "cube", "shape": list(coerced.shape), "values": coerced.astype(np.float64).ravel().tolist()}
elif isinstance(value, (list, tuple)):
    out = {"kind": "value", "value": [float(entry) for entry in value]}
else:
    out = {"kind": "value", "value": float(value)}
sys.stdout.write(json.dumps(out))
`;

function bundledPythonInterpreterPathOrThrow() {
  const relative = process.platform === "win32" ? "python.exe" : join("bin", "python3");
  const interpreterPath = join(REPO_ROOT_DIRECTORY, ".python", relative);
  if (!existsSync(interpreterPath)) {
    throw new Error(
      `The bundled Python runtime is required to pin built-in script reference outputs ` +
        `(missing ${interpreterPath}). Run: node scripts/setup-python-runtime.mjs`,
    );
  }
  return interpreterPath;
}

function runBuiltinScriptWithBundledRuntime(interpreterPath, moduleName, request) {
  const spawned = spawnSync(interpreterPath, ["-I", "-X", "utf8", "-c", REFERENCE_RUNNER_PYTHON_SOURCE], {
    input: JSON.stringify({ directory: BUILTIN_SCRIPTS_DIRECTORY, moduleName, ...request }),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (spawned.status !== 0) {
    throw new Error(`Reference run of ${moduleName} failed:\n${spawned.stderr || spawned.error}`);
  }
  return JSON.parse(spawned.stdout);
}

function cubeAsNestedBandRows(fixture) {
  return fixture.bands.map((band) => bandAsRows(band, fixture.width, fixture.height));
}

function bandAsRows(band, width, height) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Array.from(band.subarray(y * width, (y + 1) * width), Number));
  }
  return rows;
}

// One 2D 0/1 mask per category index present in the mask fixture, in index order.
function maskCategoriesAsNestedRows(maskFixture) {
  const categoryIndexes = [...new Set(maskFixture.values.filter((value) => value > 0))].sort();
  return categoryIndexes.map((categoryIndex) =>
    bandAsRows(
      Uint8Array.from(maskFixture.values, (value) => (value === categoryIndex ? 1 : 0)),
      maskFixture.width,
      maskFixture.height,
    ),
  );
}

function listBuiltinScriptReferenceRequests(fixtures) {
  const multibandCube = cubeAsNestedBandRows(fixtures.multiBandTiff);
  const multibandMasks = maskCategoriesAsNestedRows(fixtures.maskMultibandPng);
  const parityCube = cubeAsNestedBandRows(fixtures.parityStackTiff);
  return {
    npc: {
      script: "npc",
      fixture: fixtures.multiBandTiff.fileName,
      maskFixture: fixtures.maskMultibandPng.fileName,
      params: { bins: 255 },
      request: { cube: multibandCube, masks: multibandMasks, params: { bins: 255 } },
    },
    // CT-318: since NPC is scored BAND BY BAND over that band's own min-max,
    // this coarse binning no longer separates the pinned values from the fine
    // one. Each band of multiband-12bit is a ramp whose two mask classes sit in
    // its lowest and highest quarter, so every band scores exactly 1 at every
    // bin count and both references read [1, 1, 1]. What the pinned reference
    // still proves is the SHAPE: one score per band, in band order.
    npcCoarseBins: {
      script: "npc",
      fixture: fixtures.multiBandTiff.fileName,
      maskFixture: fixtures.maskMultibandPng.fileName,
      params: { bins: 2 },
      request: { cube: multibandCube, masks: multibandMasks, params: { bins: 2 } },
    },
    rop: {
      script: "rop",
      fixture: fixtures.multiBandTiff.fileName,
      params: { seed: ROP_REFERENCE_SEED, count: 1 },
      request: { cube: multibandCube, params: { seed: ROP_REFERENCE_SEED, count: 1 } },
    },
    // CT-310: the same seed searched over 50 candidates, scored by the
    // committed custom objective. Every band of multiband-12bit.tif is the SAME
    // ramp at a different offset, so every projection is an affine transform of
    // that one ramp and every scale-invariant objective (CNR, NPC) scores all
    // 50 candidates identically - the winner would be decided by float noise.
    // mask-contrast-objective.py deliberately does NOT normalize by the spread,
    // so the scores really differ and the pinned winner is stable.
    ropSearch: {
      script: "rop_search",
      fixture: fixtures.multiBandTiff.fileName,
      maskFixture: fixtures.maskMultibandPng.fileName,
      objectiveScript: ROP_SEARCH_OBJECTIVE_SCRIPT_FILE_NAME,
      params: {
        seed: ROP_REFERENCE_SEED,
        count: ROP_SEARCH_REFERENCE_PROJECTION_COUNT,
        objective: "custom",
      },
      request: {
        cube: multibandCube,
        masks: multibandMasks,
        params: {
          seed: ROP_REFERENCE_SEED,
          count: ROP_SEARCH_REFERENCE_PROJECTION_COUNT,
          objective: "custom",
          objective_source: readObjectiveScriptSource(),
        },
      },
    },
    // CT-336: the same seeded 50-candidate search under the CNR objective
    // (scored INSIDE the resident worker), so the CT-336 e2e can prove the
    // press -> search -> press sequence costs one interpreter spawn (CNR scores
    // in TS, so no per-candidate one-shot run) while still pinning the winner.
    // Every band of multiband-12bit is an affine transform of one ramp, so CNR
    // scores all 50 candidates near-identically and float noise, not the first
    // draw, decides the winner: a search that never looped could not match it.
    ropSearchCnr: {
      script: "rop_search",
      fixture: fixtures.multiBandTiff.fileName,
      maskFixture: fixtures.maskMultibandPng.fileName,
      params: {
        seed: ROP_REFERENCE_SEED,
        count: ROP_SEARCH_REFERENCE_PROJECTION_COUNT,
        objective: "cnr",
      },
      request: {
        cube: multibandCube,
        masks: multibandMasks,
        params: {
          seed: ROP_REFERENCE_SEED,
          count: ROP_SEARCH_REFERENCE_PROJECTION_COUNT,
          objective: "cnr",
          text_mask_index: 0,
          background_mask_index: 1,
        },
      },
    },
    l2Minimization: {
      script: "l2_minimization",
      fixture: fixtures.multiBandTiff.fileName,
      maskFixture: fixtures.maskMultibandPng.fileName,
      params: {},
      request: { cube: multibandCube, masks: multibandMasks, params: {} },
    },
    localPca: {
      script: "local_pca",
      fixture: fixtures.parityStackTiff.fileName,
      params: {},
      request: { cube: parityCube, params: {} },
    },
    localMnf: {
      script: "local_mnf",
      fixture: fixtures.parityStackTiff.fileName,
      params: {},
      request: { cube: parityCube, params: {} },
    },
  };
}

function computeBuiltinScriptReferenceOutputs(fixtures) {
  const interpreterPath = bundledPythonInterpreterPathOrThrow();
  const references = { ropSeed: ROP_REFERENCE_SEED };
  for (const [key, definition] of Object.entries(listBuiltinScriptReferenceRequests(fixtures))) {
    references[key] = describeReferenceOutput(definition, interpreterPath);
    process.stdout.write(`pinned builtin reference ${key} (${definition.script})\n`);
  }
  references.cnrPerBand = describeCnrPerBandReference(
    fixtures.multiBandTiff,
    fixtures.maskMultibandPng,
  );
  process.stdout.write(`pinned builtin reference cnrPerBand (computed in JS per band)\n`);
  references.ropCnr = describeRopCnrReference(references.rop, fixtures.maskMultibandPng);
  process.stdout.write(`pinned builtin reference ropCnr (computed in JS from rop)\n`);
  references.ropSearchScore = describeRopSearchScoreReference(
    references.ropSearch,
    fixtures.maskMultibandPng,
  );
  process.stdout.write(`pinned builtin reference ropSearchScore (computed in JS from ropSearch)\n`);
  return references;
}

// CT-310: the score the app records in History for the pinned search - the
// custom objective (mean of text pixels - mean of background pixels) evaluated
// in JS over the float32 winning candidate.
function describeRopSearchScoreReference(searchReference, maskFixture) {
  const winner = Float32Array.from(searchReference.values);
  const text = collectMaskCategoryValues(winner, maskFixture.values, 1);
  const background = collectMaskCategoryValues(winner, maskFixture.values, 2);
  return {
    script: searchReference.script,
    fixture: searchReference.fixture,
    maskFixture: maskFixture.fileName,
    params: searchReference.params,
    value: meanOf(text) - meanOf(background),
  };
}

// CT-320: CNR is a Multi-band tool of its own, scored BAND BY BAND with the
// same locked formula. The app computes it in TS, so the reference is computed
// here the same way, over each band's own values: text = mask category 1,
// background = category 2. Every band of multiband-12bit.tif is the same ramp
// at a different offset and the two mask classes are its top and bottom row, so
// all three bands read the same score - what the pinned list still proves is one
// score PER BAND, in band order, with the right magnitude (CT-322: CNR is the
// ABSOLUTE mean difference, so it is never negative).
function describeCnrPerBandReference(stackFixture, maskFixture) {
  return {
    script: 'cnr',
    fixture: stackFixture.fileName,
    maskFixture: maskFixture.fileName,
    params: { textCategory: 1, backgroundCategory: 2 },
    value: stackFixture.bands.map((band) => cnrScoreOfBand(band, maskFixture.values, 1, 2)),
  };
}

function cnrScoreOfBand(band, maskValues, textCategory, backgroundCategory) {
  const text = collectMaskCategoryValues(band, maskValues, textCategory);
  const background = collectMaskCategoryValues(band, maskValues, backgroundCategory);
  return Math.abs(meanOf(text) - meanOf(background)) / populationStandardDeviationOf(background);
}

// CT-309: the app computes the CNR objective in TS (not Python), so its
// reference is computed here the same way, over the float32 rop reference
// values: |mean(text px) - mean(background px)| / population std(background px)
// with ddof = 0 (CT-322: absolute value); text = mask category 1, background = category 2.
function describeRopCnrReference(ropReference, maskFixture) {
  const candidate = Float32Array.from(ropReference.values);
  const text = collectMaskCategoryValues(candidate, maskFixture.values, 1);
  const background = collectMaskCategoryValues(candidate, maskFixture.values, 2);
  const value =
    Math.abs(meanOf(text) - meanOf(background)) / populationStandardDeviationOf(background);
  return {
    script: ropReference.script,
    fixture: ropReference.fixture,
    maskFixture: maskFixture.fileName,
    params: { seed: ROP_REFERENCE_SEED, textCategory: 1, backgroundCategory: 2 },
    value,
  };
}

function collectMaskCategoryValues(candidate, maskValues, categoryIndex) {
  const collected = [];
  for (let index = 0; index < maskValues.length; index += 1) {
    if (maskValues[index] === categoryIndex) collected.push(candidate[index]);
  }
  return collected;
}

function meanOf(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationStandardDeviationOf(values) {
  const mean = meanOf(values);
  const meanSquaredDeviation = meanOf(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(meanSquaredDeviation);
}

function describeReferenceOutput(definition, interpreterPath) {
  const { request, ...description } = definition;
  const output = runBuiltinScriptWithBundledRuntime(interpreterPath, definition.script, request);
  if (output.kind === "value") return { ...description, value: output.value };
  return { ...description, shape: output.shape, values: output.values };
}

// --- Manifest ---------------------------------------------------------------

function describeMaskFixture(fixture) {
  return {
    fileName: fixture.fileName,
    ...(fixture.sidecarFileName ? { sidecarFileName: fixture.sidecarFileName } : {}),
    width: fixture.width,
    height: fixture.height,
    ...(fixture.name ? { name: fixture.name } : {}),
    ...(fixture.opacity ? { opacity: fixture.opacity } : {}),
    ...(fixture.categories ? { categories: fixture.categories } : {}),
    values: Array.from(fixture.values),
  };
}

// A zip fixture is described by its entry names plus which of them is the
// index PNG and which is the sidecar, so a spec never hard-codes the layer's
// name to find them.
function describeMaskZipFixture(fixture) {
  return {
    fileName: fixture.fileName,
    entryNames: fixture.entryNames,
    indexPngEntryName: fixture.indexPngEntryName,
    sidecarEntryName: fixture.sidecarEntryName,
  };
}

function buildFixtureManifest(fixtures, builtinScriptReferences) {
  return {
    note: "Generated by e2e/fixtures/generate-fixtures.mjs - do not edit by hand.",
    lowContrastGrayPng: describeGrayscaleFixture(fixtures.lowContrastGrayPng),
    bimodalGrayPng: describeBimodalGrayFixture(fixtures.bimodalGrayPng),
    noisyGrayPng: describeNoisyGrayFixture(fixtures.noisyGrayPng),
    rgbPng: describeRgbFixture(fixtures.rgbPng),
    multiBandTiff: describeStackFixture(fixtures.multiBandTiff, "uint16"),
    flatFieldReferenceTiff: describeStackFixture(fixtures.flatFieldReferenceTiff, "uint16"),
    rgbaTiff: describeRgbFixture(fixtures.rgbaTiff),
    paletteColorTiff: describeRgbFixture(fixtures.paletteColorTiff),
    untaggedRgbTiff: describeRgbFixture(fixtures.untaggedRgbTiff),
    enviStack: describeEnviFixture(fixtures.enviStack),
    enviNirStack: describeEnviFixture(fixtures.enviNirStack),
    enviFloatStack: describeEnviFloatFixture(fixtures.enviFloatStack),
    maskMultibandPng: describeMaskFixture(fixtures.maskMultibandPng),
    maskEightBySquarePng: describeMaskFixture(fixtures.maskEightBySquarePng),
    maskBinary1BitPng: describeMaskFixture(fixtures.maskBinary1BitPng),
    maskBinary255Png: describeMaskFixture(fixtures.maskBinary255Png),
    maskBinaryBottom255Png: describeMaskFixture(fixtures.maskBinaryBottom255Png),
    maskMultibandCategoriesZip: describeMaskZipFixture(fixtures.maskMultibandCategoriesZip),
    parityStackTiff: describeStackFixture(fixtures.parityStackTiff, "uint16"),
    builtinScriptReferences,
  };
}

function describeEnviFloatFixture(fixture) {
  return {
    headerFileName: fixture.headerFileName,
    binaryFileName: fixture.binaryFileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: fixture.bands.length,
    dataType: "float32",
    wavelengths: fixture.wavelengths,
    bandMeans: fixture.bands.map(computeMean),
    samplePixels: buildStackCornerSamplePixels(fixture.bands, fixture.width, fixture.height),
  };
}

// The sample pixels straddle the valley: the last dark pixel (3,1) and the
// first bright pixel (0,2) sit either side of the pinned Otsu cutoff.
function describeBimodalGrayFixture(fixture) {
  return {
    fileName: fixture.fileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: 1,
    dataType: "uint8",
    expectedOtsuCutoff: fixture.expectedOtsuCutoff,
    samplePixels: [
      buildSamplePixel(0, 0, [fixture.samples[0]]),
      buildSamplePixel(3, 1, [fixture.samples[7]]),
      buildSamplePixel(0, 2, [fixture.samples[8]]),
      buildSamplePixel(3, 3, [fixture.samples[15]]),
    ],
  };
}

// The spikes carry the pre (noisy), smooth base, and post (radius-1 median)
// values so the denoising spec asserts against documented numbers.
function describeNoisyGrayFixture(fixture) {
  return {
    fileName: fixture.fileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: 1,
    dataType: "uint8",
    spikes: fixture.spikes,
    samplePixels: [
      buildSamplePixel(0, 0, [fixture.samples[0]]),
      buildSamplePixel(fixture.width - 1, fixture.height - 1, [
        fixture.samples[fixture.samples.length - 1],
      ]),
    ],
  };
}

function describeGrayscaleFixture(fixture) {
  return {
    fileName: fixture.fileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: 1,
    dataType: "uint8",
    samplePixels: [
      buildSamplePixel(0, 0, [fixture.samples[0]]),
      buildSamplePixel(3, 3, [fixture.samples[fixture.samples.length - 1]]),
    ],
  };
}

function describeRgbFixture(fixture) {
  return {
    fileName: fixture.fileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: 3,
    dataType: "uint8",
    samplePixels: fixture.pixels.map((pixel) =>
      buildSamplePixel(pixel.x, pixel.y, [pixel.r, pixel.g, pixel.b]),
    ),
  };
}

function describeStackFixture(fixture, dataType) {
  return {
    fileName: fixture.fileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: fixture.bands.length,
    dataType,
    bandMeans: fixture.bands.map(computeMean),
    samplePixels: buildStackCornerSamplePixels(fixture.bands, fixture.width, fixture.height),
  };
}

function describeEnviFixture(fixture) {
  return {
    headerFileName: fixture.headerFileName,
    binaryFileName: fixture.binaryFileName,
    width: fixture.width,
    height: fixture.height,
    bandCount: fixture.bands.length,
    dataType: "uint16",
    wavelengths: fixture.wavelengths,
    bandMeans: fixture.bands.map(computeMean),
    samplePixels: buildStackCornerSamplePixels(fixture.bands, fixture.width, fixture.height),
  };
}

function buildStackCornerSamplePixels(bands, width, height) {
  const lastIndex = width * height - 1;
  return [
    buildSamplePixel(0, 0, bands.map((band) => band[0])),
    buildSamplePixel(width - 1, height - 1, bands.map((band) => band[lastIndex])),
  ];
}

function buildSamplePixel(x, y, valuesPerBand) {
  return { x, y, valuesPerBand: valuesPerBand.map((value) => Number(value)) };
}

function computeMean(band) {
  let total = 0;
  for (const value of band) total += value;
  return total / band.length;
}

await generateAllFixtures();
