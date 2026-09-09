import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import { setMaskOverlayVisibility, type MaskPanelState } from "@/lib/masks/mask-panel";

import {
  buildMaskPanelStateFromRestoredLayers,
  type RestorableMaskLayer,
} from "./project-mask-layers";
import type { ProjectMaskLayer, ProjectViewportEntry } from "./project-schema";

// CT-306: each saved mask layer is a PNG asset inside the bundle. It is
// resolved and streamed exactly like the viewport's stack asset (CT-236:
// metadata from main, bytes through the chunked opened-image read) and then
// decoded with the CT-303 mask decoder, so a mask written by this app and a
// mask dropped into the bundle by hand both read back the same way.

export interface ProjectMaskAssetReaderApi {
  resolveProjectBundleAsset(
    request: ToolboxResolveBundleAssetRequest,
  ): Promise<ToolboxResolveBundleAssetResult>;
  readOpenedImageFile(
    metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  ): Promise<ToolboxOpenedImagesFileEntry>;
}

export async function readMaskPanelStateForViewportEntry(
  projectFilePath: string,
  entry: ProjectViewportEntry,
  api: ProjectMaskAssetReaderApi = window.toolboxApi,
): Promise<MaskPanelState> {
  const restored: RestorableMaskLayer[] = [];
  for (const manifest of entry.masks) {
    restored.push(await readOneMaskLayerOrThrow(projectFilePath, manifest, api));
  }
  const panel = buildMaskPanelStateFromRestoredLayers(restored, entry.selectedMaskIndex);
  return setMaskOverlayVisibility(panel, entry.isOverlayVisible);
}

async function readOneMaskLayerOrThrow(
  projectFilePath: string,
  manifest: ProjectMaskLayer,
  api: ProjectMaskAssetReaderApi,
): Promise<RestorableMaskLayer> {
  const fileBytes = await readMaskAssetBytesOrThrow(projectFilePath, manifest, api);
  const decoded = await decodeMaskPngBytes(fileBytes);
  assertDecodedMaskMatchesManifest(decoded, manifest);
  return { manifest, values: decoded.values };
}

async function readMaskAssetBytesOrThrow(
  projectFilePath: string,
  manifest: ProjectMaskLayer,
  api: ProjectMaskAssetReaderApi,
): Promise<Uint8Array> {
  const resolved = await api.resolveProjectBundleAsset({
    projectFilePath,
    relativePath: manifest.relativePath,
  });
  if (resolved.kind === "missing") {
    throw new Error(`Bundle mask asset "${manifest.relativePath}" is missing or unreadable`);
  }
  return (await api.readOpenedImageFile(resolved.file)).bytes;
}

function assertDecodedMaskMatchesManifest(
  decoded: { width: number; height: number },
  manifest: ProjectMaskLayer,
): void {
  if (decoded.width === manifest.width && decoded.height === manifest.height) return;
  throw new Error(
    `Bundle mask asset "${manifest.relativePath}" is ${decoded.width} x ${decoded.height} ` +
      `but the project describes it as ${manifest.width} x ${manifest.height}`,
  );
}
