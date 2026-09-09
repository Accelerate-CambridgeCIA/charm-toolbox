import { SELECTABLE_GRID_LAYOUTS, type GridLayout } from "@/lib/grid/grid-layout";
import type { RasterColorInterpretation } from "@/lib/image/raster-image";
import { DEFAULT_MASK_LAYER_OPACITY_PERCENT as DEFAULT_MASK_OPACITY_PERCENT } from "@/lib/masks/mask-layer";

import {
  IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM,
  PROJECT_FILE_FORMAT_VERSION,
  SUPPORTED_PROJECT_FILE_FORMAT_VERSIONS,
  type ProjectFile,
  type ProjectMaskCategory,
  type ProjectMaskLayer,
  type ProjectOperationHistoryEntry,
  type ProjectOperationHistoryParameterValue,
  type ProjectOperationHistoryParameterValuesById,
  type ProjectViewportEntry,
  type ProjectViewportRenderingState,
  type ProjectViewportSourceReference,
  type ProjectViewportViewTransform,
} from "./project-schema";

export function parseProjectFileFromJsonString(json: string): ProjectFile {
  const parsed: unknown = JSON.parse(json);
  return validateParsedRootIsProjectFile(parsed);
}

function validateParsedRootIsProjectFile(value: unknown): ProjectFile {
  const root = expectRecordOrThrow(value, "project file root");
  ensureFormatVersionIsSupported(root["formatVersion"]);
  return {
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: parseGridLayoutOrThrow(root["gridLayout"]),
    selectedViewportIndices: parseSelectedIndicesOrThrow(root["selectedViewportIndices"]),
    viewports: parseViewportsOrThrow(root["viewports"]),
  };
}

// A supported older bundle is read into the CURRENT in-memory shape (missing
// fields take their defaults), so nothing downstream branches on the version.
function ensureFormatVersionIsSupported(value: unknown): void {
  if (typeof value !== "number" || !SUPPORTED_PROJECT_FILE_FORMAT_VERSIONS.includes(value)) {
    throw new Error(
      `Unsupported project file format version: ${String(value)} ` +
        `(expected one of ${SUPPORTED_PROJECT_FILE_FORMAT_VERSIONS.join(", ")})`,
    );
  }
}

function parseGridLayoutOrThrow(value: unknown): GridLayout {
  if (typeof value !== "string" || !isSelectableGridLayout(value)) {
    throw new Error(`Unknown grid layout in project file: ${String(value)}`);
  }
  return value;
}

function isSelectableGridLayout(value: string): value is GridLayout {
  return (SELECTABLE_GRID_LAYOUTS as ReadonlyArray<string>).includes(value);
}

function parseSelectedIndicesOrThrow(value: unknown): ReadonlyArray<number> {
  if (!Array.isArray(value)) {
    throw new Error("selectedViewportIndices must be an array");
  }
  return value.map(expectFiniteNonNegativeIntegerOrThrow);
}

function parseViewportsOrThrow(value: unknown): ReadonlyArray<ProjectViewportEntry> {
  if (!Array.isArray(value)) {
    throw new Error("viewports must be an array");
  }
  return value.map(parseViewportEntryOrThrow);
}

function parseViewportEntryOrThrow(value: unknown): ProjectViewportEntry {
  const entry = expectRecordOrThrow(value, "viewport entry");
  const masks = parseMaskLayersOrEmpty(entry["masks"]);
  return {
    index: expectFiniteNonNegativeIntegerOrThrow(entry["index"]),
    source: parseSourceReferenceOrThrow(entry["source"]),
    renderingState: parseRenderingStateOrThrow(entry["renderingState"]),
    viewTransform: parseViewTransformOrIdentity(entry["viewTransform"]),
    operationHistory: parseOperationHistoryOrEmpty(entry["operationHistory"]),
    roi: null,
    masks,
    selectedMaskIndex: parseSelectedMaskIndexOrNull(entry["selectedMaskIndex"], masks.length),
    isOverlayVisible: parseOverlayVisibilityOrDefault(entry["isOverlayVisible"]),
    ...parseColorInterpretationFieldOrOmit(entry["colorInterpretation"]),
  };
}

// CT-306: a version 2 entry has no masks key at all, which reads as "this panel
// was never annotated" rather than as a malformed bundle.
function parseMaskLayersOrEmpty(value: unknown): ReadonlyArray<ProjectMaskLayer> {
  if (!Array.isArray(value)) return [];
  return value.map(parseMaskLayerOrThrow);
}

function parseMaskLayerOrThrow(value: unknown): ProjectMaskLayer {
  const layer = expectRecordOrThrow(value, "mask layer");
  return {
    name: expectNonEmptyStringOrThrow(layer["name"], "masks.name"),
    relativePath: expectNonEmptyStringOrThrow(layer["relativePath"], "masks.relativePath"),
    width: expectPositiveIntegerOrThrow(layer["width"], "masks.width"),
    height: expectPositiveIntegerOrThrow(layer["height"], "masks.height"),
    categories: parseMaskCategoriesOrThrow(layer["categories"]),
    opacityPercent: parseOpacityPercentOrDefault(layer["opacityPercent"]),
  };
}

function parseMaskCategoriesOrThrow(value: unknown): ReadonlyArray<ProjectMaskCategory> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("masks.categories must be a non-empty array");
  }
  return value.map(parseMaskCategoryOrThrow);
}

function parseMaskCategoryOrThrow(value: unknown): ProjectMaskCategory {
  const category = expectRecordOrThrow(value, "mask category");
  return {
    name: expectNonEmptyStringOrThrow(category["name"], "masks.categories.name"),
    color: expectNonEmptyStringOrThrow(category["color"], "masks.categories.color"),
  };
}

function parseSelectedMaskIndexOrNull(value: unknown, maskCount: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 0 && value < maskCount ? value : null;
}

// CT-342: a bundle written before the overlay switch existed has no key here,
// which reads as "the overlay was showing", the flag's default.
function parseOverlayVisibilityOrDefault(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

function parseOpacityPercentOrDefault(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MASK_OPACITY_PERCENT;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function expectPositiveIntegerOrThrow(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

// CT-174: only the "rgb" tag is recognised; anything else (or its absence) leaves
// the field off entirely so a scientific stack keeps per-band grayscale viewing.
function parseColorInterpretationFieldOrOmit(
  value: unknown,
): { colorInterpretation?: RasterColorInterpretation } {
  return value === "rgb" ? { colorInterpretation: "rgb" } : {};
}

function parseSourceReferenceOrThrow(value: unknown): ProjectViewportSourceReference {
  const ref = expectRecordOrThrow(value, "viewport source reference");
  return {
    relativePath: expectNonEmptyStringOrThrow(ref["relativePath"], "source.relativePath"),
    fileName: expectNonEmptyStringOrThrow(ref["fileName"], "source.fileName"),
  };
}

function parseRenderingStateOrThrow(value: unknown): ProjectViewportRenderingState {
  const state = expectRecordOrThrow(value, "renderingState");
  return {
    normalizationEnabled: expectBooleanOrThrow(state["normalizationEnabled"], "normalizationEnabled"),
    selectedBandIndex: expectFiniteNonNegativeIntegerOrThrow(state["selectedBandIndex"]),
    lastAppliedOperationLabel: parseOptionalNullableString(state["lastAppliedOperationLabel"]),
  };
}

function parseViewTransformOrIdentity(value: unknown): ProjectViewportViewTransform {
  if (!isPlainRecord(value)) return IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM;
  return {
    zoom: parseFiniteNumberOr(value["zoom"], IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM.zoom),
    panX: parseFiniteNumberOr(value["panX"], IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM.panX),
    panY: parseFiniteNumberOr(value["panY"], IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM.panY),
  };
}

function parseOperationHistoryOrEmpty(
  value: unknown,
): ReadonlyArray<ProjectOperationHistoryEntry> {
  if (!Array.isArray(value)) return [];
  return value.map(parseOperationHistoryEntryOrThrow);
}

function parseOperationHistoryEntryOrThrow(value: unknown): ProjectOperationHistoryEntry {
  const entry = expectRecordOrThrow(value, "operation history entry");
  return {
    actionId: expectNonEmptyStringOrThrow(entry["actionId"], "operationHistory.actionId"),
    actionLabel: expectNonEmptyStringOrThrow(entry["actionLabel"], "operationHistory.actionLabel"),
    appliedLabel: expectNonEmptyStringOrThrow(
      entry["appliedLabel"],
      "operationHistory.appliedLabel",
    ),
    parameterValues: parseOperationHistoryParameterValuesOrThrow(entry["parameterValues"]),
    timestampMs: expectFiniteNonNegativeIntegerOrThrow(entry["timestampMs"]),
  };
}

function parseOperationHistoryParameterValuesOrThrow(
  value: unknown,
): ProjectOperationHistoryParameterValuesById {
  const record = expectRecordOrThrow(value, "operationHistory.parameterValues");
  const values: Record<string, ProjectOperationHistoryParameterValue> = {};
  for (const [key, entry] of Object.entries(record)) {
    values[key] = ensureOperationHistoryParameterValueOrThrow(entry, key);
  }
  return Object.freeze(values);
}

function ensureOperationHistoryParameterValueOrThrow(
  value: unknown,
  key: string,
): ProjectOperationHistoryParameterValue {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  throw new Error(
    `operationHistory.parameterValues.${key} must be a number, string, or boolean`,
  );
}

function expectRecordOrThrow(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectNonEmptyStringOrThrow(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function expectBooleanOrThrow(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function expectFiniteNonNegativeIntegerOrThrow(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer, got ${String(value)}`);
  }
  return value;
}

function parseFiniteNumberOr(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function parseOptionalNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return value;
}
