import { describe, expect, it } from "vitest";

import { parseProjectFileFromJsonString } from "./parse-project";
import { PROJECT_FILE_FORMAT_VERSION } from "./project-schema";

describe("parseProjectFileFromJsonString", () => {
  it("parses a minimal valid project file with one viewport", () => {
    const json = buildValidProjectJsonWithSingleViewport();
    const project = parseProjectFileFromJsonString(json);
    expect(project.formatVersion).toBe(PROJECT_FILE_FORMAT_VERSION);
    expect(project.gridLayout).toBe("1x1");
    expect(project.viewports).toHaveLength(1);
    const [first] = project.viewports;
    expect(first?.source.relativePath).toBe("assets/sample.tif");
    expect(first?.source.fileName).toBe("sample.tif");
    expect(first?.renderingState.normalizationEnabled).toBe(true);
    expect(first?.renderingState.selectedBandIndex).toBe(2);
  });

  it("falls back to identity view transform when missing", () => {
    const project = parseProjectFileFromJsonString(buildProjectJsonWithoutViewTransform());
    const [first] = project.viewports;
    expect(first?.viewTransform.zoom).toBe(1);
    expect(first?.viewTransform.panX).toBe(0);
    expect(first?.viewTransform.panY).toBe(0);
  });

  it("captures the selected viewport indices array", () => {
    const project = parseProjectFileFromJsonString(buildValidProjectJsonWithSingleViewport());
    expect(project.selectedViewportIndices).toEqual([0]);
  });

  it("rejects an unsupported format version with a clear error", () => {
    const json = JSON.stringify({ formatVersion: 99, gridLayout: "1x1", selectedViewportIndices: [], viewports: [] });
    expect(() => parseProjectFileFromJsonString(json)).toThrow(
      /Unsupported project file format version/,
    );
  });

  it("rejects the legacy v1 ctproj format with a clear error", () => {
    const json = JSON.stringify({ formatVersion: 1, gridLayout: "1x1", selectedViewportIndices: [], viewports: [] });
    expect(() => parseProjectFileFromJsonString(json)).toThrow(
      /Unsupported project file format version/,
    );
  });

  it("rejects an unknown grid layout", () => {
    const json = JSON.stringify({
      formatVersion: PROJECT_FILE_FORMAT_VERSION,
      gridLayout: "5x5",
      selectedViewportIndices: [],
      viewports: [],
    });
    expect(() => parseProjectFileFromJsonString(json)).toThrow(/Unknown grid layout/);
  });

  it("rejects a non-object JSON root", () => {
    expect(() => parseProjectFileFromJsonString("[]")).toThrow();
    expect(() => parseProjectFileFromJsonString("\"hello\"")).toThrow();
  });

  it("rejects a viewport entry missing the source.fileName field", () => {
    const json = buildProjectJsonWithoutFileName();
    expect(() => parseProjectFileFromJsonString(json)).toThrow(
      /source\.fileName must be a non-empty string/,
    );
  });

  it("parses a populated operationHistory array on a viewport entry", () => {
    const project = parseProjectFileFromJsonString(
      buildProjectJsonWithSingleHistoryEntry(),
    );
    const [first] = project.viewports;
    expect(first?.operationHistory).toHaveLength(1);
    const entry = first?.operationHistory[0];
    expect(entry?.actionId).toBe("bit-shift");
    expect(entry?.actionLabel).toBe("Bit Shift");
    expect(entry?.appliedLabel).toBe("Bit shift +4");
    expect(entry?.parameterValues).toEqual({ shiftAmount: 4 });
    expect(entry?.timestampMs).toBe(1_700_000_000_000);
  });

  it("restores the rgb colour interpretation flag from a manifest viewport entry", () => {
    const project = parseProjectFileFromJsonString(
      buildProjectJsonWithColorInterpretation("rgb"),
    );
    expect(project.viewports[0]?.colorInterpretation).toBe("rgb");
  });

  it("leaves the colour interpretation flag absent for a scientific stack entry", () => {
    const project = parseProjectFileFromJsonString(buildValidProjectJsonWithSingleViewport());
    expect(project.viewports[0]?.colorInterpretation).toBeUndefined();
  });

  it("ignores an unrecognised colour interpretation value", () => {
    const project = parseProjectFileFromJsonString(
      buildProjectJsonWithColorInterpretation("cmyk"),
    );
    expect(project.viewports[0]?.colorInterpretation).toBeUndefined();
  });

  it("rejects an operationHistory entry that has a nested-object parameter value", () => {
    const project = {
      formatVersion: PROJECT_FILE_FORMAT_VERSION,
      gridLayout: "1x1",
      selectedViewportIndices: [],
      viewports: [
        {
          index: 0,
          source: { relativePath: "assets/a.tif", fileName: "a.tif" },
          renderingState: {
            normalizationEnabled: false,
            selectedBandIndex: 0,
            lastAppliedOperationLabel: null,
          },
          operationHistory: [
            {
              actionId: "x",
              actionLabel: "X",
              appliedLabel: "X applied",
              parameterValues: { nested: { bad: 1 } },
              timestampMs: 1,
            },
          ],
          roi: null,
        },
      ],
    };
    expect(() => parseProjectFileFromJsonString(JSON.stringify(project))).toThrow(
      /operationHistory\.parameterValues\.nested/,
    );
  });
});

// CT-306: version 3 added mask layers. Version 2 stays readable and simply has
// no masks, so a project saved before this story opens exactly as before.
describe("parseProjectFileFromJsonString mask layers", () => {
  it("accepts a version 2 bundle and reads it with no mask layers", () => {
    const project = parseProjectFileFromJsonString(buildProjectJsonAtVersion(2, {}));
    expect(project.formatVersion).toBe(PROJECT_FILE_FORMAT_VERSION);
    expect(project.viewports[0]?.masks).toEqual([]);
    expect(project.viewports[0]?.selectedMaskIndex).toBeNull();
  });

  it("parses a version 3 mask layer with its asset path, categories, and opacity", () => {
    const project = parseProjectFileFromJsonString(
      buildProjectJsonAtVersion(3, { masks: [buildManifestMaskLayer()], selectedMaskIndex: 0 }),
    );
    expect(project.viewports[0]?.masks).toEqual([
      {
        name: "Parchment mask",
        relativePath: "assets/viewport-0-mask-0.png",
        width: 4,
        height: 4,
        categories: [
          { name: "Parchment", color: "#ef4444" },
          { name: "Substrate", color: "#3b82f6" },
        ],
        opacityPercent: 60,
      },
    ]);
    expect(project.viewports[0]?.selectedMaskIndex).toBe(0);
  });

  it("drops a selected mask position that no mask layer occupies", () => {
    const project = parseProjectFileFromJsonString(
      buildProjectJsonAtVersion(3, { masks: [buildManifestMaskLayer()], selectedMaskIndex: 7 }),
    );
    expect(project.viewports[0]?.selectedMaskIndex).toBeNull();
  });

  it("defaults a missing mask opacity rather than failing the open", () => {
    const project = parseProjectFileFromJsonString(
      buildProjectJsonAtVersion(3, { masks: [buildMaskLayerWithout("opacityPercent")] }),
    );
    expect(project.viewports[0]?.masks[0]?.opacityPercent).toBe(50);
  });

  // CT-342: the overlay switch is optional on read - a bundle written before it
  // existed reopens showing its masks, the flag's default.
  it("defaults the mask overlay to visible when the bundle predates the switch", () => {
    const project = parseProjectFileFromJsonString(
      buildProjectJsonAtVersion(3, { masks: [buildManifestMaskLayer()], selectedMaskIndex: 0 }),
    );
    expect(project.viewports[0]?.isOverlayVisible).toBe(true);
  });

  it("reads a recorded hidden mask overlay back as hidden", () => {
    const project = parseProjectFileFromJsonString(
      buildProjectJsonAtVersion(3, {
        masks: [buildManifestMaskLayer()],
        selectedMaskIndex: 0,
        isOverlayVisible: false,
      }),
    );
    expect(project.viewports[0]?.isOverlayVisible).toBe(false);
  });

  it("rejects a mask layer with no asset path", () => {
    expect(() =>
      parseProjectFileFromJsonString(
        buildProjectJsonAtVersion(3, { masks: [buildMaskLayerWithout("relativePath")] }),
      ),
    ).toThrow(/masks\.relativePath must be a non-empty string/);
  });

  it("rejects a mask layer with no categories", () => {
    expect(() =>
      parseProjectFileFromJsonString(
        buildProjectJsonAtVersion(3, {
          masks: [{ ...buildManifestMaskLayer(), categories: [] }],
        }),
      ),
    ).toThrow(/masks\.categories must be a non-empty array/);
  });
});

function buildMaskLayerWithout(
  droppedField: keyof ReturnType<typeof buildManifestMaskLayer>,
): Record<string, unknown> {
  const layer: Record<string, unknown> = { ...buildManifestMaskLayer() };
  delete layer[droppedField];
  return layer;
}

function buildManifestMaskLayer() {
  return {
    name: "Parchment mask",
    relativePath: "assets/viewport-0-mask-0.png",
    width: 4,
    height: 4,
    categories: [
      { name: "Parchment", color: "#ef4444" },
      { name: "Substrate", color: "#3b82f6" },
    ],
    opacityPercent: 60,
  };
}

function buildProjectJsonAtVersion(
  formatVersion: number,
  viewportFields: Record<string, unknown>,
): string {
  return JSON.stringify({
    formatVersion,
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        source: { relativePath: "assets/viewport-0.tif", fileName: "sample.tif" },
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
        roi: null,
        ...viewportFields,
      },
    ],
  });
}

function buildProjectJsonWithSingleHistoryEntry(): string {
  return JSON.stringify({
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: [],
    viewports: [
      {
        index: 0,
        source: { relativePath: "assets/a.tif", fileName: "a.tif" },
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: "Bit shift +4",
        },
        operationHistory: [
          {
            actionId: "bit-shift",
            actionLabel: "Bit Shift",
            appliedLabel: "Bit shift +4",
            parameterValues: { shiftAmount: 4 },
            timestampMs: 1_700_000_000_000,
          },
        ],
        roi: null,
      },
    ],
  });
}

function buildProjectJsonWithColorInterpretation(colorInterpretation: string): string {
  return JSON.stringify({
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        source: { relativePath: "assets/photo.hdr", fileName: "photo.png" },
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
        roi: null,
        colorInterpretation,
      },
    ],
  });
}

function buildValidProjectJsonWithSingleViewport(): string {
  return JSON.stringify({
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        source: { relativePath: "assets/sample.tif", fileName: "sample.tif" },
        renderingState: {
          normalizationEnabled: true,
          selectedBandIndex: 2,
          lastAppliedOperationLabel: null,
        },
        viewTransform: { zoom: 2, panX: 0.1, panY: -0.5 },
        operationHistory: [],
        roi: null,
      },
    ],
  });
}

function buildProjectJsonWithoutViewTransform(): string {
  return JSON.stringify({
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: [],
    viewports: [
      {
        index: 0,
        source: { relativePath: "assets/a.tif", fileName: "a.tif" },
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
        roi: null,
      },
    ],
  });
}

function buildProjectJsonWithoutFileName(): string {
  return JSON.stringify({
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: [],
    viewports: [
      {
        index: 0,
        source: { relativePath: "assets/a.tif" },
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
        roi: null,
      },
    ],
  });
}
