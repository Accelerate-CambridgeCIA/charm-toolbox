import type { GridLayout } from "@/lib/grid/grid-layout";
import type { RasterColorInterpretation } from "@/lib/image/raster-image";

export const PROJECT_FILE_FORMAT_VERSION = 3;
export const PROJECT_BUNDLE_EXTENSION = "ctbundle";

// CT-306: version 3 added mask layers. A version 2 bundle is still opened as
// written - it simply has no masks - so the two versions are both readable and
// only the newest is ever written.
export const SUPPORTED_PROJECT_FILE_FORMAT_VERSIONS: ReadonlyArray<number> =
  Object.freeze([2, PROJECT_FILE_FORMAT_VERSION]);

export interface ProjectViewportSourceReference {
  readonly relativePath: string;
  readonly fileName: string;
}

export interface ProjectViewportRenderingState {
  readonly normalizationEnabled: boolean;
  readonly selectedBandIndex: number;
  readonly lastAppliedOperationLabel: string | null;
}

export interface ProjectViewportViewTransform {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export type ProjectOperationHistoryParameterValue = number | string | boolean;
export type ProjectOperationHistoryParameterValuesById = Readonly<
  Record<string, ProjectOperationHistoryParameterValue>
>;

export interface ProjectOperationHistoryEntry {
  readonly actionId: string;
  readonly actionLabel: string;
  readonly appliedLabel: string;
  readonly parameterValues: ProjectOperationHistoryParameterValuesById;
  readonly timestampMs: number;
}

// CT-306: a mask layer's labelling lives in the manifest; its per-pixel
// category indexes live in the PNG asset named by relativePath.
export interface ProjectMaskCategory {
  readonly name: string;
  readonly color: string;
}

export interface ProjectMaskLayer {
  readonly name: string;
  readonly relativePath: string;
  readonly width: number;
  readonly height: number;
  readonly categories: ReadonlyArray<ProjectMaskCategory>;
  readonly opacityPercent: number;
}

export interface ProjectViewportEntry {
  readonly index: number;
  readonly source: ProjectViewportSourceReference;
  readonly renderingState: ProjectViewportRenderingState;
  readonly viewTransform: ProjectViewportViewTransform;
  readonly operationHistory: ReadonlyArray<ProjectOperationHistoryEntry>;
  readonly roi: null;
  // CT-174: a baked true-colour photo is re-encoded as a 3-band ENVI/TIFF asset,
  // which has nowhere to record that its bands are display R/G/B. The flag is
  // persisted here in the manifest instead and re-applied on open so a saved
  // colour photo reopens as an RGB composite rather than reverting to grayscale.
  readonly colorInterpretation?: RasterColorInterpretation;
  // CT-306: empty for every version 2 bundle and for any panel the user never
  // annotated. selectedMaskIndex is a position into masks, or null.
  readonly masks: ReadonlyArray<ProjectMaskLayer>;
  readonly selectedMaskIndex: number | null;
  // CT-342: the panel's mask overlay switch. Absent from every bundle written
  // before it existed, which reads as visible.
  readonly isOverlayVisible: boolean;
}

export interface ProjectFile {
  readonly formatVersion: typeof PROJECT_FILE_FORMAT_VERSION;
  readonly gridLayout: GridLayout;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<ProjectViewportEntry>;
}

export const IDENTITY_PROJECT_VIEWPORT_VIEW_TRANSFORM: ProjectViewportViewTransform = {
  zoom: 1,
  panX: 0,
  panY: 0,
};
