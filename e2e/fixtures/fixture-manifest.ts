import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import manifestJson from "./manifest.json" with { type: "json" };

export interface FixtureSamplePixel {
  readonly x: number;
  readonly y: number;
  readonly valuesPerBand: ReadonlyArray<number>;
}

export interface SingleFileFixture {
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
  readonly dataType: string;
  readonly bandMeans?: ReadonlyArray<number>;
  readonly samplePixels: ReadonlyArray<FixtureSamplePixel>;
}

export interface EnviFixture {
  readonly headerFileName: string;
  readonly binaryFileName: string;
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
  readonly dataType: string;
  readonly wavelengths: ReadonlyArray<number>;
  readonly bandMeans: ReadonlyArray<number>;
  readonly samplePixels: ReadonlyArray<FixtureSamplePixel>;
}

// CT-201: a grayscale fixture whose values form two separated clusters with a
// known empty valley; the generator pins the expected Otsu cutoff.
export interface BimodalGrayFixture extends SingleFileFixture {
  readonly expectedOtsuCutoff: number;
}

// CT-204: a smooth grayscale fixture with fixed salt-and-pepper spikes; the
// generator pins each spike's noisy (pre) value, smooth base value, and
// radius-1 median-denoised (post) value.
export interface NoisyGraySpike {
  readonly x: number;
  readonly y: number;
  readonly noisyValue: number;
  readonly smoothValue: number;
  readonly medianDenoisedValue: number;
}

export interface NoisyGrayFixture extends SingleFileFixture {
  readonly spikes: ReadonlyArray<NoisyGraySpike>;
}

// CT-303: a mask fixture is an 8-bit grayscale PNG of CATEGORY INDEXES (0 =
// unlabeled) plus, when it has one, the JSON sidecar naming its categories.
export interface MaskFixtureCategory {
  readonly index: number;
  readonly name: string;
  readonly color: string;
}

export interface MaskFixture {
  readonly fileName: string;
  readonly sidecarFileName?: string;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
  readonly opacity?: number;
  readonly categories?: ReadonlyArray<MaskFixtureCategory>;
  readonly values: ReadonlyArray<number>;
}

// CT-328: a mask zip fixture written by another tool (yazl, so DEFLATED). It
// names its entries plus which of them is the index PNG and which is the JSON
// sidecar, the pair a lossless re-import rebuilds the layer from.
export interface MaskZipFixture {
  readonly fileName: string;
  readonly entryNames: ReadonlyArray<string>;
  readonly indexPngEntryName: string;
  readonly sidecarEntryName: string;
}

// CT-307: reference outputs pinned by the generate-fixtures.mjs reference
// runner, which executes the built-in algorithm scripts with the bundled
// Python runtime. The parity oracle for CT-308 through CT-313: app results
// must match within 1e-4 relative tolerance.
export interface BuiltinScriptReferenceBase {
  readonly script: string;
  readonly fixture: string;
  readonly maskFixture?: string;
  // CT-310: the committed .py the app imports as the search objective.
  readonly objectiveScript?: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

export interface BuiltinScriptValueReference extends BuiltinScriptReferenceBase {
  readonly value: number;
}

// CT-318: a per-band measurement pins one score per band, in band order.
export interface BuiltinScriptValueListReference extends BuiltinScriptReferenceBase {
  readonly value: ReadonlyArray<number>;
}

export interface BuiltinScriptCubeReference extends BuiltinScriptReferenceBase {
  readonly shape: ReadonlyArray<number>;
  readonly values: ReadonlyArray<number>;
}

export interface BuiltinScriptReferences {
  readonly ropSeed: number;
  readonly npc: BuiltinScriptValueListReference;
  // CT-318: the same fixture scored with a coarse binning. Scored band by band
  // over each band's own min-max, both binnings read [1, 1, 1] on this fixture:
  // what the pair still pins is one score PER BAND, in band order.
  readonly npcCoarseBins: BuiltinScriptValueListReference;
  readonly rop: BuiltinScriptCubeReference;
  // CT-309: the CNR objective score of the pinned rop candidate against the
  // mask fixture (text = category 1, background = category 2), computed by the
  // generator in JS over the float32 reference values with the exact locked
  // formula, since the app computes CNR in TS rather than in Python.
  readonly ropCnr: BuiltinScriptValueReference;
  // CT-320: the CNR tool scores every band of multiband-12bit.tif against the
  // mask fixture (text = category 1, background = category 2), computed by the
  // generator in JS with the same locked formula the app runs in TS.
  readonly cnrPerBand: BuiltinScriptValueListReference;
  // CT-310: the best of 50 seeded candidates under the committed custom
  // objective (mask-contrast-objective.py), and that winner's score computed in
  // JS. The winner is NOT the first draw, so a search that ignored its
  // objective - or never looped - cannot match it.
  readonly ropSearch: BuiltinScriptCubeReference;
  readonly ropSearchScore: BuiltinScriptValueReference;
  // CT-336: the best of the same 50 seeded candidates under the CNR objective
  // (scored inside the resident worker). Used by the press -> search -> press
  // spawn-count e2e, where CNR keeps scoring in TS so the whole sequence costs
  // one interpreter spawn. Deterministic given the seed, but not the first draw.
  readonly ropSearchCnr: BuiltinScriptCubeReference;
  readonly l2Minimization: BuiltinScriptCubeReference;
  readonly localPca: BuiltinScriptCubeReference;
  readonly localMnf: BuiltinScriptCubeReference;
}

const FIXTURES_DIRECTORY = dirname(fileURLToPath(import.meta.url));

// CT-272: written by generate-png16-fixture.mjs (sharp/libvips, an external
// reference encoder), NOT by generate-fixtures.mjs, so it is pinned here by
// hand instead of in manifest.json. value = 300 + (y*width + x) * 500; every
// pixel exceeds 255, so an 8-bit downscale cannot reproduce these readouts.
export const gradientGray16Png: SingleFileFixture = {
  fileName: "gradient-gray16.png",
  width: 6,
  height: 4,
  bandCount: 1,
  dataType: "uint16",
  samplePixels: [
    { x: 0, y: 0, valuesPerBand: [300] },
    { x: 3, y: 1, valuesPerBand: [4800] },
    { x: 5, y: 3, valuesPerBand: [11800] },
  ],
};

export const lowContrastGrayPng = manifestJson.lowContrastGrayPng as SingleFileFixture;
export const bimodalGrayPng = manifestJson.bimodalGrayPng as BimodalGrayFixture;
export const noisyGrayPng = manifestJson.noisyGrayPng as NoisyGrayFixture;
export const rgbPng = manifestJson.rgbPng as SingleFileFixture;
export const multiBandTiff = manifestJson.multiBandTiff as SingleFileFixture;
export const flatFieldReferenceTiff = manifestJson.flatFieldReferenceTiff as SingleFileFixture;
export const rgbaTiff = manifestJson.rgbaTiff as SingleFileFixture;
export const paletteColorTiff = manifestJson.paletteColorTiff as SingleFileFixture;
export const untaggedRgbTiff = manifestJson.untaggedRgbTiff as SingleFileFixture;
export const enviStack = manifestJson.enviStack as EnviFixture;
export const enviFloatStack = manifestJson.enviFloatStack as EnviFixture;
export const maskMultibandPng = manifestJson.maskMultibandPng as MaskFixture;
export const maskEightBySquarePng = manifestJson.maskEightBySquarePng as MaskFixture;
export const maskBinary1BitPng = manifestJson.maskBinary1BitPng as MaskFixture;
export const maskBinary255Png = manifestJson.maskBinary255Png as MaskFixture;
export const maskBinaryBottom255Png = manifestJson.maskBinaryBottom255Png as MaskFixture;
export const maskMultibandCategoriesZip =
  manifestJson.maskMultibandCategoriesZip as MaskZipFixture;
export const parityStackTiff = manifestJson.parityStackTiff as SingleFileFixture;
export const builtinScriptReferences =
  manifestJson.builtinScriptReferences as unknown as BuiltinScriptReferences;

export function fixturePath(fileName: string): string {
  return join(FIXTURES_DIRECTORY, fileName);
}
