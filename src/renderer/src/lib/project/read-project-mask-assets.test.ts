import { describe, expect, it, vi } from "vitest";

import { encodeMaskValuesAsGrayscalePngBytes } from "@/lib/masks/mask-png-encode";

import {
  readMaskPanelStateForViewportEntry,
  type ProjectMaskAssetReaderApi,
} from "./read-project-mask-assets";
import type { ProjectMaskLayer, ProjectViewportEntry } from "./project-schema";

describe("readMaskPanelStateForViewportEntry", () => {
  it("reads no assets for an entry with no mask layers", async () => {
    const api = buildReaderApi(new Map());
    const panel = await readMaskPanelStateForViewportEntry("/tmp/p/project.json", buildEntry([]), api);
    expect(panel.layers).toEqual([]);
    expect(api.resolveProjectBundleAsset).not.toHaveBeenCalled();
  });

  it("restores a layer's painted values, labelling, and opacity from its PNG asset", async () => {
    const values = Uint8Array.from([0, 1, 2, 1]);
    const api = buildReaderApi(await buildAssetsFor([["assets/viewport-0-mask-0.png", values]]));
    const panel = await readMaskPanelStateForViewportEntry(
      "/tmp/p/project.json",
      buildEntry([buildManifest("Parchment mask", "assets/viewport-0-mask-0.png")]),
      api,
    );
    expect(Array.from(panel.layers[0]!.values)).toEqual([0, 1, 2, 1]);
    expect(panel.layers[0]!.name).toBe("Parchment mask");
    expect(panel.layers[0]!.opacityPercent).toBe(60);
  });

  it("resolves each mask asset relative to the extracted project file", async () => {
    const api = buildReaderApi(
      await buildAssetsFor([["assets/viewport-0-mask-0.png", Uint8Array.from([1, 1, 1, 1])]]),
    );
    await readMaskPanelStateForViewportEntry(
      "/tmp/p/project.json",
      buildEntry([buildManifest("Mask 1", "assets/viewport-0-mask-0.png")]),
      api,
    );
    expect(api.resolveProjectBundleAsset).toHaveBeenCalledWith({
      projectFilePath: "/tmp/p/project.json",
      relativePath: "assets/viewport-0-mask-0.png",
    });
  });

  it("selects the layer the entry recorded as selected", async () => {
    const api = buildReaderApi(
      await buildAssetsFor([
        ["assets/viewport-0-mask-0.png", Uint8Array.from([1, 0, 0, 0])],
        ["assets/viewport-0-mask-1.png", Uint8Array.from([0, 1, 0, 0])],
      ]),
    );
    const entry = buildEntry(
      [
        buildManifest("Mask 1", "assets/viewport-0-mask-0.png"),
        buildManifest("Mask 2", "assets/viewport-0-mask-1.png"),
      ],
      0,
    );
    const panel = await readMaskPanelStateForViewportEntry("/tmp/p/project.json", entry, api);
    expect(panel.layers.map((layer) => layer.name)).toEqual(["Mask 1", "Mask 2"]);
    expect(panel.selectedLayerId).toBe("mask-1");
  });

  // CT-342: the restored panel carries the overlay switch the bundle recorded,
  // so reopening a project shows exactly the masks it was saved showing.
  it("restores the overlay visibility the entry recorded", async () => {
    const api = buildReaderApi(
      await buildAssetsFor([["assets/viewport-0-mask-0.png", Uint8Array.from([1, 0, 0, 0])]]),
    );
    const manifests = [buildManifest("Mask 1", "assets/viewport-0-mask-0.png")];
    const visible = await readMaskPanelStateForViewportEntry(
      "/tmp/p/project.json",
      buildEntry(manifests, 0, true),
      api,
    );
    const hidden = await readMaskPanelStateForViewportEntry(
      "/tmp/p/project.json",
      buildEntry(manifests, 0, false),
      api,
    );
    expect(visible.isOverlayVisible).toBe(true);
    expect(hidden.isOverlayVisible).toBe(false);
  });

  it("fails with the asset path when a mask asset is missing from the bundle", async () => {
    const api = buildReaderApi(new Map());
    await expect(
      readMaskPanelStateForViewportEntry(
        "/tmp/p/project.json",
        buildEntry([buildManifest("Mask 1", "assets/viewport-0-mask-0.png")]),
        api,
      ),
    ).rejects.toThrow(/assets\/viewport-0-mask-0\.png" is missing or unreadable/);
  });

  it("fails when the asset's grid does not match the size the manifest describes", async () => {
    const api = buildReaderApi(
      await buildAssetsFor([["assets/viewport-0-mask-0.png", Uint8Array.from([1, 1, 1, 1, 1, 1]), 3, 2]]),
    );
    await expect(
      readMaskPanelStateForViewportEntry(
        "/tmp/p/project.json",
        buildEntry([buildManifest("Mask 1", "assets/viewport-0-mask-0.png")]),
        api,
      ),
    ).rejects.toThrow(/is 3 x 2 but the project describes it as 2 x 2/);
  });
});

type AssetsByRelativePath = Map<string, Uint8Array>;

async function buildAssetsFor(
  described: ReadonlyArray<[string, Uint8Array] | [string, Uint8Array, number, number]>,
): Promise<AssetsByRelativePath> {
  const assets: AssetsByRelativePath = new Map();
  for (const [relativePath, values, width = 2, height = 2] of described) {
    assets.set(relativePath, await encodeMaskValuesAsGrayscalePngBytes(width, height, values));
  }
  return assets;
}

function buildReaderApi(assets: AssetsByRelativePath): {
  resolveProjectBundleAsset: ReturnType<typeof vi.fn>;
  readOpenedImageFile: ReturnType<typeof vi.fn>;
} & ProjectMaskAssetReaderApi {
  const resolveProjectBundleAsset = vi.fn(async (request: { relativePath: string }) =>
    assets.has(request.relativePath)
      ? { kind: "found" as const, file: buildFileMetadata(request.relativePath) }
      : { kind: "missing" as const, relativePath: request.relativePath },
  );
  const readOpenedImageFile = vi.fn(async (metadata: { filePath: string }) => ({
    fileName: metadata.filePath,
    filePath: metadata.filePath,
    fileSizeBytes: assets.get(metadata.filePath)!.byteLength,
    bytes: assets.get(metadata.filePath)!,
  }));
  return { resolveProjectBundleAsset, readOpenedImageFile } as never;
}

function buildFileMetadata(relativePath: string) {
  return { fileName: relativePath, filePath: relativePath, fileSizeBytes: 0 };
}

function buildManifest(name: string, relativePath: string): ProjectMaskLayer {
  return {
    name,
    relativePath,
    width: 2,
    height: 2,
    categories: [
      { name: "Parchment", color: "#ef4444" },
      { name: "Substrate", color: "#3b82f6" },
    ],
    opacityPercent: 60,
  };
}

function buildEntry(
  masks: ReadonlyArray<ProjectMaskLayer>,
  selectedMaskIndex: number | null = null,
  isOverlayVisible = true,
): ProjectViewportEntry {
  return {
    index: 0,
    source: { relativePath: "assets/viewport-0.tif", fileName: "sample.tif" },
    renderingState: {
      normalizationEnabled: false,
      selectedBandIndex: 0,
      lastAppliedOperationLabel: null,
    },
    viewTransform: { zoom: 1, panX: 0, panY: 0 },
    operationHistory: [],
    roi: null,
    masks,
    selectedMaskIndex,
    isOverlayVisible,
  };
}
