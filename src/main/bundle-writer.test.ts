import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  planBundleAssetRelativePathsForViewports,
  writeProjectBundleAtPath,
  type BundleDraft,
  type BundleDraftViewportEntry,
} from "./bundle-writer";
import { extractProjectBundleToFreshTempDirectory } from "./extract-project-bundle";

let workspaceDir: string;

beforeAll(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), "save-bundle-test-"));
});

afterAll(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

async function writeExternalSourceFixture(
  fileName: string,
  marker: string,
): Promise<{ absolutePath: string; bytes: Uint8Array }> {
  const absolutePath = join(workspaceDir, fileName);
  const bytes = new TextEncoder().encode(`fixture-${marker}`);
  await writeFile(absolutePath, bytes);
  return { absolutePath, bytes };
}

function buildExternalAssetViewport(
  index: number,
  fileName: string,
  absolutePath: string,
): BundleDraftViewportEntry {
  return {
    index,
    fileName,
    asset: { kind: "external", absolutePath, extension: extensionOf(fileName) },
    renderingState: {
      normalizationEnabled: false,
      selectedBandIndex: 0,
      lastAppliedOperationLabel: null,
    },
    operationHistory: [],
  };
}

// CT-219e: baked assets reach the writer as spool FILE PATHS (the chunked save
// protocol spools their bytes to disk), so the fixtures write part files first.
async function buildBakedTiffAssetViewport(
  index: number,
  fileName: string,
  bytes: Uint8Array,
): Promise<BundleDraftViewportEntry> {
  const spool = await writeSpoolPartFixture(`baked-${index}-${fileName}.primary`, bytes);
  return {
    index,
    fileName,
    asset: { kind: "baked", primary: { absolutePath: spool, extension: "tif" } },
    renderingState: {
      normalizationEnabled: false,
      selectedBandIndex: 0,
      lastAppliedOperationLabel: null,
    },
    operationHistory: [],
  };
}

async function buildBakedEnviAssetViewport(
  index: number,
  fileName: string,
  headerBytes: Uint8Array,
  binaryBytes: Uint8Array,
): Promise<BundleDraftViewportEntry> {
  const headerSpool = await writeSpoolPartFixture(`baked-${index}-${fileName}.primary`, headerBytes);
  const binarySpool = await writeSpoolPartFixture(`baked-${index}-${fileName}.sidecar`, binaryBytes);
  return {
    index,
    fileName,
    asset: {
      kind: "baked",
      primary: { absolutePath: headerSpool, extension: "hdr" },
      sidecar: { absolutePath: binarySpool, extension: "bin" },
    },
    renderingState: {
      normalizationEnabled: false,
      selectedBandIndex: 0,
      lastAppliedOperationLabel: null,
    },
    operationHistory: [],
  };
}

async function writeSpoolPartFixture(name: string, bytes: Uint8Array): Promise<string> {
  const absolutePath = join(workspaceDir, name.replace(/[^a-z0-9.-]/gi, "_"));
  await writeFile(absolutePath, bytes);
  return absolutePath;
}

function buildDraftFromViewports(
  viewports: ReadonlyArray<BundleDraftViewportEntry>,
  options: Partial<Pick<BundleDraft, "gridLayout" | "selectedViewportIndices">> = {},
): BundleDraft {
  return {
    formatVersion: 2,
    gridLayout: options.gridLayout ?? "1x1",
    selectedViewportIndices: options.selectedViewportIndices ?? [],
    viewports,
  };
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1) : "";
}

async function readColorInterpretationFromBundleManifest(
  bundlePath: string,
): Promise<string | undefined> {
  const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
  try {
    const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
    const parsed = JSON.parse(projectJsonText) as {
      viewports: ReadonlyArray<{ colorInterpretation?: string }>;
    };
    return parsed.viewports[0]!.colorInterpretation;
  } finally {
    await rm(extractedDir, { recursive: true, force: true });
  }
}

describe("writeProjectBundleAtPath round-trip", () => {
  it("writes a zip with project.json plus a baked asset and rewritten path", async () => {
    const tifBytes = new TextEncoder().encode("fake-tiff-bytes");
    const draft = buildDraftFromViewports([
      await buildBakedTiffAssetViewport(0, "sample.tif", tifBytes),
    ]);
    const bundlePath = join(workspaceDir, "baked.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
      const parsed = JSON.parse(projectJsonText) as {
        viewports: ReadonlyArray<{ source: { relativePath: string; fileName: string } }>;
      };
      expect(parsed.viewports[0]!.source.relativePath).toBe("assets/viewport-0.tif");
      expect(parsed.viewports[0]!.source.fileName).toBe("sample.tif");
      const tifBack = await readFile(join(extractedDir, "assets", "viewport-0.tif"));
      expect(new Uint8Array(tifBack)).toEqual(tifBytes);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("includes baked ENVI .bin sidecars under the same viewport stem", async () => {
    const headerBytes = new TextEncoder().encode("hdr-bytes");
    const binaryBytes = new TextEncoder().encode("bin-bytes");
    const draft = buildDraftFromViewports([
      await buildBakedEnviAssetViewport(0, "cube.hdr", headerBytes, binaryBytes),
    ]);
    const bundlePath = join(workspaceDir, "envi.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const headerBack = await readFile(join(extractedDir, "assets", "viewport-0.hdr"));
      const binaryBack = await readFile(join(extractedDir, "assets", "viewport-0.bin"));
      expect(new Uint8Array(headerBack)).toEqual(headerBytes);
      expect(new Uint8Array(binaryBack)).toEqual(binaryBytes);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("streams external-source files from disk into the bundle assets folder", async () => {
    const fixture = await writeExternalSourceFixture("photo.png", "external");
    const draft = buildDraftFromViewports([
      buildExternalAssetViewport(0, "photo.png", fixture.absolutePath),
    ]);
    const bundlePath = join(workspaceDir, "external.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const back = await readFile(join(extractedDir, "assets", "viewport-0.png"));
      expect(new Uint8Array(back)).toEqual(fixture.bytes);
      const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
      const parsed = JSON.parse(projectJsonText) as {
        viewports: ReadonlyArray<{ source: { relativePath: string } }>;
      };
      expect(parsed.viewports[0]!.source.relativePath).toBe("assets/viewport-0.png");
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("streams an external ENVI .hdr source together with its on-disk .bin sidecar", async () => {
    const header = await writeExternalSourceFixture("scene.hdr", "envi-header");
    const binary = await writeExternalSourceFixture("scene.bin", "envi-binary");
    const draft = buildDraftFromViewports([
      buildExternalAssetViewport(0, "scene.hdr", header.absolutePath),
    ]);
    const bundlePath = join(workspaceDir, "external-envi.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const headerBack = await readFile(join(extractedDir, "assets", "viewport-0.hdr"));
      const binaryBack = await readFile(join(extractedDir, "assets", "viewport-0.bin"));
      expect(new Uint8Array(headerBack)).toEqual(header.bytes);
      expect(new Uint8Array(binaryBack)).toEqual(binary.bytes);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("persists the rgb colour interpretation flag for a baked true-colour photo", async () => {
    const tifBytes = new TextEncoder().encode("fake-photo-bytes");
    const draft = buildDraftFromViewports([
      { ...(await buildBakedTiffAssetViewport(0, "photo.png", tifBytes)), colorInterpretation: "rgb" },
    ]);
    const bundlePath = join(workspaceDir, "photo.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const colorInterpretation = await readColorInterpretationFromBundleManifest(bundlePath);
    expect(colorInterpretation).toBe("rgb");
  });

  it("omits the colour interpretation flag for a scientific stack viewport", async () => {
    const headerBytes = new TextEncoder().encode("hdr-bytes");
    const binaryBytes = new TextEncoder().encode("bin-bytes");
    const draft = buildDraftFromViewports([
      await buildBakedEnviAssetViewport(0, "cube.hdr", headerBytes, binaryBytes),
    ]);
    const bundlePath = join(workspaceDir, "stack.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const colorInterpretation = await readColorInterpretationFromBundleManifest(bundlePath);
    expect(colorInterpretation).toBeUndefined();
  });

  it("preserves selectedViewportIndices and gridLayout in the rewritten project.json", async () => {
    const tifBytes = new TextEncoder().encode("fake-tiff-bytes");
    const draft = buildDraftFromViewports(
      [
        await buildBakedTiffAssetViewport(0, "a.tif", tifBytes),
        await buildBakedTiffAssetViewport(2, "b.tif", tifBytes),
      ],
      { gridLayout: "2x2", selectedViewportIndices: [0, 2] },
    );
    const bundlePath = join(workspaceDir, "preserve.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
      const parsed = JSON.parse(projectJsonText) as {
        gridLayout: string;
        selectedViewportIndices: ReadonlyArray<number>;
        viewports: ReadonlyArray<{ index: number }>;
      };
      expect(parsed.gridLayout).toBe("2x2");
      expect(parsed.selectedViewportIndices).toEqual([0, 2]);
      expect(parsed.viewports.map((v) => v.index)).toEqual([0, 2]);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });
});

// CT-306: a viewport's assets are no longer "one primary plus at most one
// sidecar" - it also carries one PNG per mask layer, so the path planner has to
// name an open-ended list of assets under the same viewport stem.
describe("planBundleAssetRelativePathsForViewports with mask layers", () => {
  it("names one mask asset per layer under the viewport's stem", () => {
    const viewport = withMaskLayers(
      buildExternalAssetViewport(2, "photo.png", "/abs/photo.png"),
      ["Mask 1", "Mask 2"],
    );
    const [paths] = planBundleAssetRelativePathsForViewports([viewport]);
    expect(paths?.primaryRelativePath).toBe("assets/viewport-2.png");
    expect(paths?.maskRelativePaths).toEqual([
      "assets/viewport-2-mask-0.png",
      "assets/viewport-2-mask-1.png",
    ]);
  });

  it("plans no mask assets for a viewport that was never annotated", () => {
    const viewport = buildExternalAssetViewport(0, "photo.png", "/abs/photo.png");
    const [paths] = planBundleAssetRelativePathsForViewports([viewport]);
    expect(paths?.maskRelativePaths).toEqual([]);
  });

  it("keeps mask paths clear of the ENVI .bin sidecar sharing the same stem", () => {
    const viewport = withMaskLayers(
      buildExternalAssetViewport(0, "scene.hdr", "/abs/scene.hdr"),
      ["Mask 1"],
    );
    const [paths] = planBundleAssetRelativePathsForViewports([viewport]);
    expect(paths?.sidecarRelativePath).toBe("assets/viewport-0.bin");
    expect(paths?.maskRelativePaths).toEqual(["assets/viewport-0-mask-0.png"]);
  });
});

describe("writeProjectBundleAtPath with mask layers", () => {
  it("writes each mask PNG into assets and records it in the manifest", async () => {
    const maskBytes = new TextEncoder().encode("fake-mask-png");
    const maskSpool = await writeSpoolPartFixture("mask-0.png", maskBytes);
    const source = await writeExternalSourceFixture("masked.png", "with-mask");
    const draft = buildDraftFromViewports([
      {
        ...buildExternalAssetViewport(0, "masked.png", source.absolutePath),
        masks: [
          {
            absolutePath: maskSpool,
            name: "Parchment mask",
            width: 4,
            height: 4,
            categories: [{ name: "Parchment", color: "#ef4444" }],
            opacityPercent: 60,
          },
        ],
        selectedMaskIndex: 0,
      },
    ]);
    const bundlePath = join(workspaceDir, "masked.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const maskBack = await readFile(join(extractedDir, "assets", "viewport-0-mask-0.png"));
      expect(new Uint8Array(maskBack)).toEqual(maskBytes);
      const manifest = await readManifestFromExtractedBundle(extractedDir);
      expect(manifest.formatVersion).toBe(3);
      expect(manifest.viewports[0]!.selectedMaskIndex).toBe(0);
      expect(manifest.viewports[0]!.masks).toEqual([
        {
          name: "Parchment mask",
          relativePath: "assets/viewport-0-mask-0.png",
          width: 4,
          height: 4,
          categories: [{ name: "Parchment", color: "#ef4444" }],
          opacityPercent: 60,
        },
      ]);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  // CT-342: the writer defaults the overlay switch to visible so a draft built
  // before the flag existed still produces a manifest the reader accepts.
  it("records the mask overlay visibility, defaulting to visible", async () => {
    const source = await writeExternalSourceFixture("switch.png", "with-switch");
    const base = buildExternalAssetViewport(0, "switch.png", source.absolutePath);
    const draft = buildDraftFromViewports([
      { ...base, isOverlayVisible: false },
      { ...buildExternalAssetViewport(1, "switch.png", source.absolutePath) },
    ]);
    const bundlePath = join(workspaceDir, "switch.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const manifest = await readManifestFromExtractedBundle(extractedDir);
      expect(manifest.viewports[0]!.isOverlayVisible).toBe(false);
      expect(manifest.viewports[1]!.isOverlayVisible).toBe(true);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("records an empty masks array for a viewport that was never annotated", async () => {
    const source = await writeExternalSourceFixture("plain.png", "no-mask");
    const draft = buildDraftFromViewports([
      buildExternalAssetViewport(0, "plain.png", source.absolutePath),
    ]);
    const bundlePath = join(workspaceDir, "plain.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const manifest = await readManifestFromExtractedBundle(extractedDir);
      expect(manifest.viewports[0]!.masks).toEqual([]);
      expect(manifest.viewports[0]!.selectedMaskIndex).toBeNull();
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });
});

interface ExtractedBundleManifest {
  readonly formatVersion: number;
  readonly viewports: ReadonlyArray<{
    masks: ReadonlyArray<unknown>;
    selectedMaskIndex: number | null;
    isOverlayVisible: boolean;
  }>;
}

async function readManifestFromExtractedBundle(
  extractedDir: string,
): Promise<ExtractedBundleManifest> {
  const text = await readFile(join(extractedDir, "project.json"), "utf-8");
  return JSON.parse(text) as ExtractedBundleManifest;
}

function withMaskLayers(
  viewport: BundleDraftViewportEntry,
  layerNames: ReadonlyArray<string>,
): BundleDraftViewportEntry {
  return {
    ...viewport,
    masks: layerNames.map((name, position) => ({
      absolutePath: `/abs/spool-mask-${position}.png`,
      name,
      width: 4,
      height: 4,
      categories: [{ name: "Foreground", color: "#ef4444" }],
      opacityPercent: 50,
    })),
    selectedMaskIndex: 0,
  };
}
