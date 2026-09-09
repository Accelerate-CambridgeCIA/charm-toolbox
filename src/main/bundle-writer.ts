import { createWriteStream } from "node:fs";
import { ZipFile } from "yazl";

import { findEnviBinarySiblingPathOrNull } from "./envi-binary-sibling";

// CT-306: version 3 added the per-viewport masks array and its PNG assets.
const BUNDLE_FORMAT_VERSION = 3;

const ENVI_HEADER_ASSET_EXTENSION = "hdr";
const ENVI_BINARY_SIDECAR_EXTENSION = "bin";
const MASK_ASSET_EXTENSION = "png";

export type BundleDraftOperationHistoryParameterValue = number | string | boolean;

export interface BundleDraftOperationHistoryEntry {
  readonly actionId: string;
  readonly actionLabel: string;
  readonly appliedLabel: string;
  readonly parameterValues: Readonly<
    Record<string, BundleDraftOperationHistoryParameterValue>
  >;
  readonly timestampMs: number;
}

export interface BundleDraftViewportRenderingState {
  readonly normalizationEnabled: boolean;
  readonly selectedBandIndex: number;
  readonly lastAppliedOperationLabel: string | null;
}

// CT-219e: baked asset bytes never cross IPC (or memory) whole; they arrive as
// chunks spooled to temp files (chunked-save-bundle.ts) and the writer streams
// those files into the zip from disk.
export interface BundleDraftBakedAssetPart {
  readonly absolutePath: string;
  readonly extension: string;
}

export interface BundleDraftBakedAsset {
  readonly kind: "baked";
  readonly primary: BundleDraftBakedAssetPart;
  readonly sidecar?: BundleDraftBakedAssetPart;
}

export interface BundleDraftExternalAsset {
  readonly kind: "external";
  readonly absolutePath: string;
  readonly extension: string;
}

export type BundleDraftAsset = BundleDraftBakedAsset | BundleDraftExternalAsset;

export interface BundleDraftMaskCategory {
  readonly name: string;
  readonly color: string;
}

// CT-306: one mask layer. Its category indexes arrive as a spooled 8-bit PNG
// (the same encoding the CT-303 mask export writes); everything else here is
// the labelling the manifest records beside it.
export interface BundleDraftMaskAsset {
  readonly absolutePath: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly categories: ReadonlyArray<BundleDraftMaskCategory>;
  readonly opacityPercent: number;
}

export interface BundleDraftViewportEntry {
  readonly index: number;
  readonly fileName: string;
  readonly asset: BundleDraftAsset;
  readonly renderingState: BundleDraftViewportRenderingState;
  readonly operationHistory: ReadonlyArray<BundleDraftOperationHistoryEntry>;
  // CT-174: preserved in the manifest so a baked true-colour photo reopens as a
  // colour composite (the baked ENVI/TIFF asset cannot carry this itself).
  readonly colorInterpretation?: "rgb";
  readonly masks?: ReadonlyArray<BundleDraftMaskAsset>;
  readonly selectedMaskIndex?: number | null;
  readonly isOverlayVisible?: boolean;
}

export interface BundleDraft {
  readonly formatVersion: number;
  readonly gridLayout: string;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<BundleDraftViewportEntry>;
}

// CT-306: a viewport no longer has a fixed primary-plus-sidecar asset shape, so
// the plan carries the stack's paths AND one path per mask layer, indexed by
// the layer's position.
interface ResolvedBundleAssetPaths {
  readonly viewportIndex: number;
  readonly primaryRelativePath: string;
  readonly sidecarRelativePath: string | null;
  readonly maskRelativePaths: ReadonlyArray<string>;
}

export async function writeProjectBundleAtPath(
  outputPath: string,
  draft: BundleDraft,
): Promise<void> {
  const assetPaths = planBundleAssetRelativePathsForViewports(draft.viewports);
  await streamBundleZipFileToOutputPath(outputPath, draft, assetPaths);
}

export function planBundleAssetRelativePathsForViewports(
  viewports: ReadonlyArray<BundleDraftViewportEntry>,
): ReadonlyArray<ResolvedBundleAssetPaths> {
  return viewports.map(buildAssetPathsForViewport);
}

function buildAssetPathsForViewport(
  viewport: BundleDraftViewportEntry,
): ResolvedBundleAssetPaths {
  const stem = `viewport-${viewport.index}`;
  return {
    viewportIndex: viewport.index,
    primaryRelativePath: `assets/${stem}.${primaryExtensionOfAsset(viewport.asset)}`,
    sidecarRelativePath: pickSidecarRelativePathOrNull(stem, viewport.asset),
    maskRelativePaths: buildMaskRelativePaths(stem, viewport.masks ?? []),
  };
}

function buildMaskRelativePaths(
  stem: string,
  masks: ReadonlyArray<BundleDraftMaskAsset>,
): ReadonlyArray<string> {
  return masks.map((_, position) => `assets/${stem}-mask-${position}.${MASK_ASSET_EXTENSION}`);
}

function primaryExtensionOfAsset(asset: BundleDraftAsset): string {
  return asset.kind === "baked" ? asset.primary.extension : asset.extension;
}

function pickSidecarRelativePathOrNull(stem: string, asset: BundleDraftAsset): string | null {
  if (asset.kind === "baked" && asset.sidecar) {
    return `assets/${stem}.${asset.sidecar.extension}`;
  }
  if (asset.kind === "external" && isEnviHeaderAsset(asset)) {
    return `assets/${stem}.${ENVI_BINARY_SIDECAR_EXTENSION}`;
  }
  return null;
}

function isEnviHeaderAsset(asset: BundleDraftExternalAsset): boolean {
  return asset.extension.toLowerCase() === ENVI_HEADER_ASSET_EXTENSION;
}

async function streamBundleZipFileToOutputPath(
  outputPath: string,
  draft: BundleDraft,
  assetPaths: ReadonlyArray<ResolvedBundleAssetPaths>,
): Promise<void> {
  const zip = new ZipFile();
  const completion = pipeZipOutputStreamToFile(zip, outputPath);
  appendProjectJsonEntryToZip(zip, draft, assetPaths);
  await appendAllAssetEntriesToZip(zip, draft, assetPaths);
  zip.end();
  await completion;
}

function pipeZipOutputStreamToFile(zip: ZipFile, outputPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(outputPath);
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };
    writeStream.on("close", () => settle(resolve));
    writeStream.on("error", (err) => settle(() => reject(err)));
    zip.outputStream.on("error", (err) => settle(() => reject(err)));
    zip.outputStream.pipe(writeStream);
  });
}

function appendProjectJsonEntryToZip(
  zip: ZipFile,
  draft: BundleDraft,
  assetPaths: ReadonlyArray<ResolvedBundleAssetPaths>,
): void {
  const buffer = buildBundleProjectJsonBuffer(draft, assetPaths);
  zip.addBuffer(buffer, "project.json");
}

async function appendAllAssetEntriesToZip(
  zip: ZipFile,
  draft: BundleDraft,
  assetPaths: ReadonlyArray<ResolvedBundleAssetPaths>,
): Promise<void> {
  for (let i = 0; i < draft.viewports.length; i += 1) {
    await appendAssetEntriesForViewport(zip, draft.viewports[i]!, assetPaths[i]!);
  }
}

async function appendAssetEntriesForViewport(
  zip: ZipFile,
  viewport: BundleDraftViewportEntry,
  paths: ResolvedBundleAssetPaths,
): Promise<void> {
  await appendStackAssetEntriesForViewport(zip, viewport, paths);
  appendMaskAssetEntriesToZip(zip, viewport.masks ?? [], paths.maskRelativePaths);
}

async function appendStackAssetEntriesForViewport(
  zip: ZipFile,
  viewport: BundleDraftViewportEntry,
  paths: ResolvedBundleAssetPaths,
): Promise<void> {
  if (viewport.asset.kind === "baked") {
    appendBakedAssetEntriesToZip(zip, viewport.asset, paths);
    return;
  }
  await appendExternalAssetEntriesToZip(zip, viewport.asset, paths);
}

function appendMaskAssetEntriesToZip(
  zip: ZipFile,
  masks: ReadonlyArray<BundleDraftMaskAsset>,
  maskRelativePaths: ReadonlyArray<string>,
): void {
  masks.forEach((mask, position) => zip.addFile(mask.absolutePath, maskRelativePaths[position]!));
}

async function appendExternalAssetEntriesToZip(
  zip: ZipFile,
  asset: BundleDraftExternalAsset,
  paths: ResolvedBundleAssetPaths,
): Promise<void> {
  zip.addFile(asset.absolutePath, paths.primaryRelativePath);
  await appendExternalEnviBinarySidecarIfPresent(zip, asset, paths);
}

async function appendExternalEnviBinarySidecarIfPresent(
  zip: ZipFile,
  asset: BundleDraftExternalAsset,
  paths: ResolvedBundleAssetPaths,
): Promise<void> {
  if (paths.sidecarRelativePath === null) return;
  const sidecarSourcePath = await findEnviBinarySiblingPathOrNull(asset.absolutePath);
  if (sidecarSourcePath === null) return;
  zip.addFile(sidecarSourcePath, paths.sidecarRelativePath);
}

function appendBakedAssetEntriesToZip(
  zip: ZipFile,
  asset: BundleDraftBakedAsset,
  paths: ResolvedBundleAssetPaths,
): void {
  zip.addFile(asset.primary.absolutePath, paths.primaryRelativePath);
  if (!asset.sidecar || !paths.sidecarRelativePath) return;
  zip.addFile(asset.sidecar.absolutePath, paths.sidecarRelativePath);
}

function buildBundleProjectJsonBuffer(
  draft: BundleDraft,
  assetPaths: ReadonlyArray<ResolvedBundleAssetPaths>,
): Buffer {
  const data = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    gridLayout: draft.gridLayout,
    selectedViewportIndices: draft.selectedViewportIndices,
    viewports: draft.viewports.map((viewport, index) =>
      buildBundleViewportEntryWithRewrittenPath(viewport, assetPaths[index]!),
    ),
  };
  return Buffer.from(JSON.stringify(data, null, 2), "utf-8");
}

function buildBundleViewportEntryWithRewrittenPath(
  viewport: BundleDraftViewportEntry,
  paths: ResolvedBundleAssetPaths,
): unknown {
  return {
    index: viewport.index,
    source: {
      relativePath: paths.primaryRelativePath,
      fileName: viewport.fileName,
    },
    renderingState: viewport.renderingState,
    viewTransform: { zoom: 1, panX: 0, panY: 0 },
    operationHistory: viewport.operationHistory,
    roi: null,
    // Dropped from the JSON by JSON.stringify when undefined, so a scientific
    // stack leaves no colour tag in the manifest.
    colorInterpretation: viewport.colorInterpretation,
    masks: describeMaskLayersForManifest(viewport.masks ?? [], paths.maskRelativePaths),
    selectedMaskIndex: viewport.selectedMaskIndex ?? null,
    isOverlayVisible: viewport.isOverlayVisible ?? true,
  };
}

function describeMaskLayersForManifest(
  masks: ReadonlyArray<BundleDraftMaskAsset>,
  maskRelativePaths: ReadonlyArray<string>,
): ReadonlyArray<unknown> {
  return masks.map((mask, position) => ({
    name: mask.name,
    relativePath: maskRelativePaths[position]!,
    width: mask.width,
    height: mask.height,
    categories: mask.categories,
    opacityPercent: mask.opacityPercent,
  }));
}
