import { randomUUID } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BundleDraft,
  BundleDraftAsset,
  BundleDraftMaskAsset,
  BundleDraftViewportEntry,
} from "./bundle-writer";
import {
  buildMaskAssetPartKey,
  type SaveBundleAssetPart,
  type SaveBundleBakedPartDescriptor,
  type SaveBundleDraftHeader,
  type SaveBundleMaskLayerDescriptor,
  type SaveBundleViewportHeaderEntry,
} from "../shared/chunked-save-bundle-protocol";

const MASK_ASSET_EXTENSION = "png";

// CT-219e: electron-free session bookkeeping for the chunked project-save
// protocol (see src/shared/chunked-save-bundle-protocol.ts for why the old
// whole-draft invoke killed the renderer at gigabyte scale). Baked asset bytes
// SPOOL TO TEMP FILES as chunks arrive, so the main process never holds a
// baked stack in memory; the bundle writer then streams the spool files into
// the zip from disk. The IPC layer (save-bundle-dialog.ts) owns the save
// dialog and the write; this module owns only the transfer state.

export interface WritableSpooledBundleDraft {
  readonly outputFilePath: string;
  readonly draft: BundleDraft;
}

export interface SaveBundleSessionStore {
  begin(header: SaveBundleDraftHeader, outputFilePath: string): Promise<string>;
  appendAssetChunk(
    token: string,
    viewportIndex: number,
    part: SaveBundleAssetPart,
    bytes: Uint8Array,
  ): Promise<void>;
  takeWritableBundleDraft(token: string): Promise<WritableSpooledBundleDraft>;
  release(token: string): Promise<void>;
}

interface SpooledAssetPart {
  readonly descriptor: SaveBundleBakedPartDescriptor;
  readonly path: string;
  handle: FileHandle | null;
  receivedBytes: number;
}

interface SaveBundleSession {
  readonly header: SaveBundleDraftHeader;
  readonly outputFilePath: string;
  readonly partsByKey: Map<string, SpooledAssetPart>;
  hasFinished: boolean;
}

export function createSaveBundleSessionStore(
  temporaryDirectory: string = tmpdir(),
): SaveBundleSessionStore {
  const sessions = new Map<string, SaveBundleSession>();
  return {
    begin: (header, outputFilePath) =>
      beginSession(sessions, header, outputFilePath, temporaryDirectory),
    appendAssetChunk: async (token, viewportIndex, part, bytes) =>
      appendChunkToSpooledPart(requireSession(sessions, token), viewportIndex, part, bytes),
    takeWritableBundleDraft: async (token) =>
      takeWritableDraftFromSession(requireSession(sessions, token)),
    release: (token) => releaseSessionDiscardingSpools(sessions, token),
  };
}

async function beginSession(
  sessions: Map<string, SaveBundleSession>,
  header: SaveBundleDraftHeader,
  outputFilePath: string,
  temporaryDirectory: string,
): Promise<string> {
  const token = randomUUID();
  sessions.set(token, {
    header,
    outputFilePath,
    partsByKey: await openSpoolFilesForBakedParts(header, temporaryDirectory, token),
    hasFinished: false,
  });
  return token;
}

async function openSpoolFilesForBakedParts(
  header: SaveBundleDraftHeader,
  temporaryDirectory: string,
  token: string,
): Promise<Map<string, SpooledAssetPart>> {
  const parts = new Map<string, SpooledAssetPart>();
  for (const viewport of header.viewports) {
    for (const [part, descriptor] of listBakedPartDescriptors(viewport)) {
      const key = partKey(viewport.index, part);
      parts.set(key, await openOneSpoolFile(descriptor, temporaryDirectory, token, key));
    }
  }
  return parts;
}

// CT-306: a viewport spools its stack parts (when baked) AND one part per mask
// layer, so a panel whose stack streams from disk unchanged still spools masks.
function listBakedPartDescriptors(
  viewport: SaveBundleViewportHeaderEntry,
): ReadonlyArray<[SaveBundleAssetPart, SaveBundleBakedPartDescriptor]> {
  return [...listStackPartDescriptors(viewport), ...listMaskPartDescriptors(viewport)];
}

function listStackPartDescriptors(
  viewport: SaveBundleViewportHeaderEntry,
): ReadonlyArray<[SaveBundleAssetPart, SaveBundleBakedPartDescriptor]> {
  if (viewport.asset.kind !== "baked") return [];
  const parts: [SaveBundleAssetPart, SaveBundleBakedPartDescriptor][] = [
    ["primary", assertValidPartDescriptor(viewport.asset.primary)],
  ];
  if (viewport.asset.sidecar) parts.push(["sidecar", assertValidPartDescriptor(viewport.asset.sidecar)]);
  return parts;
}

function listMaskPartDescriptors(
  viewport: SaveBundleViewportHeaderEntry,
): ReadonlyArray<[SaveBundleAssetPart, SaveBundleBakedPartDescriptor]> {
  return (viewport.masks ?? []).map((mask, position) => [
    buildMaskAssetPartKey(position),
    assertValidPartDescriptor({
      extension: MASK_ASSET_EXTENSION,
      byteLength: mask.byteLength,
    }),
  ]);
}

function assertValidPartDescriptor(
  descriptor: SaveBundleBakedPartDescriptor,
): SaveBundleBakedPartDescriptor {
  if (!Number.isInteger(descriptor.byteLength) || descriptor.byteLength <= 0) {
    throw new Error("The project described an invalid packed stack size.");
  }
  return descriptor;
}

async function openOneSpoolFile(
  descriptor: SaveBundleBakedPartDescriptor,
  temporaryDirectory: string,
  token: string,
  key: string,
): Promise<SpooledAssetPart> {
  const path = join(temporaryDirectory, `msi-save-bundle-${token}-${key}.bin`);
  return { descriptor, path, handle: await open(path, "w+"), receivedBytes: 0 };
}

function partKey(viewportIndex: number, part: SaveBundleAssetPart): string {
  return `vp${viewportIndex}-${part}`;
}

function requireSession(
  sessions: Map<string, SaveBundleSession>,
  token: string,
): SaveBundleSession {
  const session = sessions.get(token);
  if (session === undefined) throw new Error("Unknown project save token");
  return session;
}

async function appendChunkToSpooledPart(
  session: SaveBundleSession,
  viewportIndex: number,
  part: SaveBundleAssetPart,
  bytes: Uint8Array,
): Promise<void> {
  const spooled = requireSpooledPart(session, viewportIndex, part);
  if (spooled.handle === null) throw new Error("This project save already finished");
  if (bytes.byteLength === 0 || spooled.receivedBytes + bytes.byteLength > spooled.descriptor.byteLength) {
    throw new Error("The packed stack bytes did not match the described size.");
  }
  await writeExactLengthAtOffset(spooled.handle, bytes, spooled.receivedBytes).catch(
    rethrowDescribingDiskFullSaveFailure,
  );
  spooled.receivedBytes += bytes.byteLength;
}

// CT-235: with the bake size cap gone, running out of disk while spooling or
// writing the bundle is the one expected failure at very large scale. Surface
// it in the app's error vocabulary instead of the raw fs error; everything
// else rethrows untouched.
const NOT_ENOUGH_DISK_SPACE_MESSAGE =
  "There is not enough disk space to save this project. Free up space and try again.";

export function rethrowDescribingDiskFullSaveFailure(error: unknown): never {
  rethrowDescribingDiskFullFailure(error, NOT_ENOUGH_DISK_SPACE_MESSAGE);
}

// CT-237: the image-save session store surfaces the same failure with its own
// vocabulary ("this image" instead of "this project").
export function rethrowDescribingDiskFullFailure(
  error: unknown,
  describedMessage: string,
): never {
  if (isDiskFullError(error)) throw new Error(describedMessage);
  throw error;
}

function isDiskFullError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOSPC" || code === "EDQUOT";
}

function requireSpooledPart(
  session: SaveBundleSession,
  viewportIndex: number,
  part: SaveBundleAssetPart,
): SpooledAssetPart {
  if (session.hasFinished) throw new Error("This project save already finished");
  const spooled = session.partsByKey.get(partKey(viewportIndex, part));
  if (spooled === undefined) {
    throw new Error("The project save received stack bytes for an unknown panel.");
  }
  return spooled;
}

// FileHandle.write may write fewer bytes than asked; an unchecked short write
// leaves silent holes in the spool file (the CT-219g lesson). Exported for the
// CT-237 image-save session store, which appends chunks the same way.
export async function writeExactLengthAtOffset(
  handle: FileHandle,
  bytes: Uint8Array,
  offsetBytes: number,
): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, written, bytes.byteLength - written, offsetBytes + written);
    if (bytesWritten === 0) throw new Error("A spooled stack write made no progress");
    written += bytesWritten;
  }
}

async function takeWritableDraftFromSession(
  session: SaveBundleSession,
): Promise<WritableSpooledBundleDraft> {
  if (session.hasFinished) throw new Error("This project save already finished");
  assertEveryPartFullyReceived(session);
  session.hasFinished = true;
  await closeAllSpoolHandles(session);
  return { outputFilePath: session.outputFilePath, draft: buildWriterDraftFromSession(session) };
}

function assertEveryPartFullyReceived(session: SaveBundleSession): void {
  for (const spooled of session.partsByKey.values()) {
    if (spooled.receivedBytes !== spooled.descriptor.byteLength) {
      throw new Error("The packed stack bytes did not match the described size.");
    }
  }
}

async function closeAllSpoolHandles(session: SaveBundleSession): Promise<void> {
  for (const spooled of session.partsByKey.values()) {
    await spooled.handle?.close().catch(() => undefined);
    spooled.handle = null;
  }
}

function buildWriterDraftFromSession(session: SaveBundleSession): BundleDraft {
  return {
    formatVersion: session.header.formatVersion,
    gridLayout: session.header.gridLayout,
    selectedViewportIndices: session.header.selectedViewportIndices,
    viewports: session.header.viewports.map((viewport) =>
      buildWriterViewportEntry(session, viewport),
    ),
  };
}

function buildWriterViewportEntry(
  session: SaveBundleSession,
  viewport: SaveBundleViewportHeaderEntry,
): BundleDraftViewportEntry {
  return {
    index: viewport.index,
    fileName: viewport.fileName,
    asset: buildWriterAssetForViewport(session, viewport),
    renderingState: viewport.renderingState,
    operationHistory: viewport.operationHistory,
    masks: buildWriterMaskAssets(session, viewport),
    selectedMaskIndex: viewport.selectedMaskIndex ?? null,
    isOverlayVisible: viewport.isOverlayVisible ?? true,
    ...(viewport.colorInterpretation ? { colorInterpretation: viewport.colorInterpretation } : {}),
  };
}

function buildWriterMaskAssets(
  session: SaveBundleSession,
  viewport: SaveBundleViewportHeaderEntry,
): ReadonlyArray<BundleDraftMaskAsset> {
  return (viewport.masks ?? []).map((mask, position) =>
    buildWriterMaskAssetAtPosition(session, viewport.index, mask, position),
  );
}

function buildWriterMaskAssetAtPosition(
  session: SaveBundleSession,
  viewportIndex: number,
  mask: SaveBundleMaskLayerDescriptor,
  position: number,
): BundleDraftMaskAsset {
  return {
    absolutePath: spoolPathOrThrow(session, viewportIndex, buildMaskAssetPartKey(position)),
    name: mask.name,
    width: mask.width,
    height: mask.height,
    categories: mask.categories,
    opacityPercent: mask.opacityPercent,
  };
}

function buildWriterAssetForViewport(
  session: SaveBundleSession,
  viewport: SaveBundleViewportHeaderEntry,
): BundleDraftAsset {
  if (viewport.asset.kind === "external") return viewport.asset;
  const sidecar = viewport.asset.sidecar
    ? {
        absolutePath: spoolPathOrThrow(session, viewport.index, "sidecar"),
        extension: viewport.asset.sidecar.extension,
      }
    : undefined;
  return {
    kind: "baked",
    primary: {
      absolutePath: spoolPathOrThrow(session, viewport.index, "primary"),
      extension: viewport.asset.primary.extension,
    },
    ...(sidecar ? { sidecar } : {}),
  };
}

function spoolPathOrThrow(
  session: SaveBundleSession,
  viewportIndex: number,
  part: SaveBundleAssetPart,
): string {
  const spooled = session.partsByKey.get(partKey(viewportIndex, part));
  if (spooled === undefined) {
    throw new Error("The project save received stack bytes for an unknown panel.");
  }
  return spooled.path;
}

async function releaseSessionDiscardingSpools(
  sessions: Map<string, SaveBundleSession>,
  token: string,
): Promise<void> {
  const session = sessions.get(token);
  if (session === undefined) return;
  sessions.delete(token);
  await closeAllSpoolHandles(session);
  for (const spooled of session.partsByKey.values()) {
    await unlink(spooled.path).catch(() => undefined);
  }
}
