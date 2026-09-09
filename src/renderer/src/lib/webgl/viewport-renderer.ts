// Raw WebGL2 backing for the Viewport. Chosen over regl/twgl to keep deps
// minimal and to give later stages direct control over uniforms (CT-011 onward).

import {
  VIEWPORT_FRAGMENT_SHADER_SOURCE,
  VIEWPORT_VERTEX_SHADER_SOURCE,
  compileShaderOrThrow,
  linkProgramOrThrow,
} from "./shaders";
import {
  createTextureFromBrowserSource,
  deleteTextureSafely,
  getImageSourceDimensions,
  type ViewportImageSource,
} from "./texture";
import {
  DEFAULT_RASTER_TILE_SIZE,
  splitRasterBandIntoTiles,
  type RasterBandPixelGrid,
  type RasterTile,
} from "./raster-tile-splitter";
import {
  createRgbCompositeTextureForRasterTileTriple,
  createSingleBandTextureForRasterTile,
  deleteRasterTileTexturesSafely,
  probeHalfFloatColorBufferExtension,
  type RasterTileTexture,
} from "./raster-tile-texture";
import {
  composeTileQuadTransform,
  type QuadTransform,
} from "./tile-quad-transform";
import {
  createIdentityToneCurveLutTexture,
  uploadNormalizedValuesToToneCurveLutTexture,
} from "./tone-curve-lut-texture";
import type { ToneCurveChannelPreviewLuts } from "@/lib/image/tone-curve-composite-preview";
import { recordImageTextureUpload } from "@/lib/instrumentation/render-instrumentation";
import {
  IDENTITY_PAN,
  clampUserZoom,
  computeFitToViewportScale,
  computePanForZoomAtCursor,
  computeWheelZoomFactor,
  convertCanvasPointToClipSpace,
  convertPixelDeltaToClipDelta,
  type ClipPoint,
  type UserView,
  type ViewportSize,
} from "./view-transform";
import {
  convertCanvasPixelToImagePixelClamped,
  convertCanvasPixelToImagePixelOrNull,
  convertImagePixelToCanvasPointOrNull,
  type CanvasPixelPoint,
  type CanvasToImagePixelInputs,
  type ImagePixelPoint,
} from "./canvas-to-image-pixel";
import {
  IDENTITY_RGB_CHANNEL_EXTENTS,
  computeImageRgbChannelExtents,
} from "@/lib/image/compute-image-channel-extents";
import {
  floatSourceDataFallsOutsideUnitDisplayWindow,
  resolveEffectiveFloatDisplayNormalization,
  type NormalizationState,
} from "./float-display-normalization";
import {
  clampBandIndexToRaster,
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";

const POSITION_ATTRIBUTE_LOCATION = 0;
const TEXCOORD_ATTRIBUTE_LOCATION = 1;
const VERTEX_FLOAT_COUNT = 4;
const VERTEX_STRIDE_BYTES = VERTEX_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const INITIAL_USER_ZOOM = 1;
const FALLBACK_SIZE: ViewportSize = { width: 1, height: 1 };

const HALF_FLOAT_UNSUPPORTED_MESSAGE =
  "Half-float texture support (EXT_color_buffer_half_float) was not detected. " +
  "16-bit raster images may not display correctly on this hardware.";

const FULLSCREEN_TEXTURED_QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1,
  1, -1, 1, 1,
  -1, 1, 0, 0,
  1, 1, 1, 0,
]);

interface QuadTransformUniformLocations {
  quadScale: WebGLUniformLocation | null;
  quadTranslate: WebGLUniformLocation | null;
}

interface NormalizationUniformLocations {
  enabled: WebGLUniformLocation | null;
  minColor: WebGLUniformLocation | null;
  maxColor: WebGLUniformLocation | null;
}

interface BandModeUniformLocations {
  isSingleBand: WebGLUniformLocation | null;
}

interface ToneCurveUniformLocations {
  enabled: WebGLUniformLocation | null;
  multiChannel: WebGLUniformLocation | null;
  remapsSampleDomain: WebGLUniformLocation | null;
  sampleDomainMin: WebGLUniformLocation | null;
  sampleDomainMax: WebGLUniformLocation | null;
}

interface ProgramUniformLocations {
  quadTransform: QuadTransformUniformLocations;
  normalization: NormalizationUniformLocations;
  bandMode: BandModeUniformLocations;
  toneCurve: ToneCurveUniformLocations;
}

interface RendererProgramResources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
  uniforms: ProgramUniformLocations;
}


// CT-198: a single-band float source remaps the tone-curve sample domain so the GPU
// LUT (built over the band's raw value extents) lines up with the raw values it samples.
// Disabled for integer/composite sources, where the sample is already a [0, 1] coordinate.
interface ToneCurveSampleDomain {
  readonly remaps: boolean;
  readonly min: number;
  readonly max: number;
}

const DISABLED_TONE_CURVE_SAMPLE_DOMAIN: ToneCurveSampleDomain = {
  remaps: false,
  min: 0,
  max: 1,
};

interface ToneCurvePassState {
  readonly enabled: boolean;
  readonly multiChannel: boolean;
  readonly redOrValueLutTexture: WebGLTexture | null;
  readonly greenLutTexture: WebGLTexture | null;
  readonly blueLutTexture: WebGLTexture | null;
  readonly sampleDomain: ToneCurveSampleDomain;
}

// CT-177: tracks the last values uploaded to each tone-curve LUT texture by
// reference, so editing ONE channel re-uploads only that channel's small table
// (App memoizes each channel's LUT independently). Reset on context loss so the
// recreated textures are repopulated.
interface ToneCurveLutUploadRefs {
  unitOne: ReadonlyArray<number> | null;
  green: ReadonlyArray<number> | null;
  blue: ReadonlyArray<number> | null;
}

interface RenderPassState {
  readonly normalization: NormalizationState;
  readonly isSingleBand: boolean;
  readonly toneCurve: ToneCurvePassState;
}

export interface ViewportRendererOptions {
  readonly onError?: (message: string) => void;
}

export class ViewportRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private programResources: RendererProgramResources | null = null;
  private singleTexture: WebGLTexture | null = null;
  private rasterTileTextures: RasterTileTexture[] = [];
  private currentSource: ViewportImageSource | null = null;
  private selectedRasterBandIndex = 0;
  private isSingleBandSource = false;
  private displaySize: ViewportSize = FALLBACK_SIZE;
  private imageSize: ViewportSize = FALLBACK_SIZE;
  private userZoom = INITIAL_USER_ZOOM;
  private userPan: ClipPoint = IDENTITY_PAN;
  private normalization: NormalizationState = {
    enabled: false,
    extents: IDENTITY_RGB_CHANNEL_EXTENTS,
  };
  private autoFitsFloatDisplayWindow = false;
  private toneCurveLutTexture: WebGLTexture | null = null;
  private toneCurveGreenLutTexture: WebGLTexture | null = null;
  private toneCurveBlueLutTexture: WebGLTexture | null = null;
  private toneCurveLookupTable: ReadonlyArray<number> | null = null;
  private toneCurveChannelLookupTables: ToneCurveChannelPreviewLuts | null = null;
  private toneCurveLutUploads: ToneCurveLutUploadRefs = { unitOne: null, green: null, blue: null };
  private readonly viewTransformChangeListeners = new Set<() => void>();
  private readonly handleContextLost = (event: Event): void =>
    this.respondToContextLost(event);
  private readonly handleContextRestored = (): void =>
    this.respondToContextRestored();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: ViewportRendererOptions = {},
  ) {
    this.attachContextLifecycleListeners();
    this.initializeWebGl();
  }

  setImageSource(source: ViewportImageSource, selectedBandIndex: number = 0): void {
    this.currentSource = source;
    this.selectedRasterBandIndex = clampBandIndexForSource(source, selectedBandIndex);
    this.imageSize = getImageSourceDimensions(source);
    this.isSingleBandSource = isSingleBandSourceWithSelectedBand(source);
    this.cacheNormalizationExtentsForSource(source);
    this.resetViewState();
    this.uploadCurrentSourceIfReady();
    this.draw();
  }

  setSelectedRasterBandIndex(bandIndex: number): void {
    if (!this.currentSource || this.currentSource.kind !== "raster") return;
    const clamped = clampBandIndexToRaster(this.currentSource.raster, bandIndex);
    if (clamped === this.selectedRasterBandIndex) return;
    this.selectedRasterBandIndex = clamped;
    this.cacheNormalizationExtentsForSource(this.currentSource);
    this.rebuildRasterTilesForSelectedBand();
    this.draw();
  }

  setNormalizationEnabled(enabled: boolean): void {
    if (this.normalization.enabled === enabled) return;
    this.normalization = { ...this.normalization, enabled };
    this.draw();
  }

  // CT-170: install a display-only single-band tone-curve preview built in the
  // display-normalized domain. Passing null clears it; the shader branch is then
  // fully bypassed and output is byte-for-byte identical to no curve. The
  // composite (multi-channel) preview lives on setToneCurveChannelLookupTables;
  // the two fields are independent and the caller publishes only one at a time.
  setToneCurveLookupTable(lookupTable: ReadonlyArray<number> | null): void {
    this.toneCurveLookupTable = lookupTable;
    this.uploadToneCurveLutTextures();
    this.draw();
  }

  // CT-177: install a display-only per-channel tone-curve preview for a composite.
  // Each table already folds the channel curve and the rgb/Value curve together;
  // null reverts to the single-LUT (or no) preview.
  setToneCurveChannelLookupTables(channelLookupTables: ToneCurveChannelPreviewLuts | null): void {
    this.toneCurveChannelLookupTables = channelLookupTables;
    this.uploadToneCurveLutTextures();
    this.draw();
  }

  private uploadToneCurveLutTextures(): void {
    this.uploadToneCurveLutTextureWhenChanged(this.toneCurveLutTexture, this.resolveUnitOneLutValues(), "unitOne");
    this.uploadToneCurveLutTextureWhenChanged(this.toneCurveGreenLutTexture, this.toneCurveChannelLookupTables?.green ?? null, "green");
    this.uploadToneCurveLutTextureWhenChanged(this.toneCurveBlueLutTexture, this.toneCurveChannelLookupTables?.blue ?? null, "blue");
  }

  private resolveUnitOneLutValues(): ReadonlyArray<number> | null {
    return this.toneCurveChannelLookupTables?.red ?? this.toneCurveLookupTable;
  }

  private uploadToneCurveLutTextureWhenChanged(
    texture: WebGLTexture | null,
    values: ReadonlyArray<number> | null,
    slot: keyof ToneCurveLutUploadRefs,
  ): void {
    if (!this.gl || !texture || !values || this.toneCurveLutUploads[slot] === values) return;
    uploadNormalizedValuesToToneCurveLutTexture(this.gl, texture, values);
    this.toneCurveLutUploads[slot] = values;
  }

  private cacheNormalizationExtentsForSource(source: ViewportImageSource): void {
    const extents = computeImageRgbChannelExtents(source, this.selectedRasterBandIndex);
    this.normalization = { enabled: this.normalization.enabled, extents };
    this.autoFitsFloatDisplayWindow = floatSourceDataFallsOutsideUnitDisplayWindow(source, extents);
  }

  resizeToDisplaySize(displayWidthPx: number, displayHeightPx: number): void {
    this.displaySize = { width: displayWidthPx, height: displayHeightPx };
    syncCanvasBackingResolution(this.canvas, displayWidthPx, displayHeightPx);
    this.applyViewportToCanvasSize();
    this.draw();
  }

  panByPixels(deltaXPx: number, deltaYPx: number): void {
    const delta = convertPixelDeltaToClipDelta(
      deltaXPx,
      deltaYPx,
      this.displaySize,
    );
    this.userPan = { x: this.userPan.x + delta.x, y: this.userPan.y + delta.y };
    this.draw();
  }

  zoomAtCanvasPoint(xPx: number, yPx: number, wheelDeltaY: number): void {
    const factor = computeWheelZoomFactor(wheelDeltaY);
    const newZoom = clampUserZoom(this.userZoom * factor, this.imageSize, this.displaySize);
    if (newZoom === this.userZoom) return;
    const cursorClip = convertCanvasPointToClipSpace(xPx, yPx, this.displaySize);
    this.userPan = computePanForZoomAtCursor(
      cursorClip,
      this.userPan,
      this.userZoom,
      newZoom,
    );
    this.userZoom = newZoom;
    this.draw();
  }

  resetView(): void {
    this.resetViewState();
    this.draw();
  }

  getUserView(): UserView {
    return { pan: this.userPan, zoom: this.userZoom };
  }

  // CT-207: apply a view transform supplied by a linked panel. The zoom is
  // re-clamped to this panel's own image/display bounds before drawing.
  applyUserView(view: UserView): void {
    this.userZoom = clampUserZoom(view.zoom, this.imageSize, this.displaySize);
    this.userPan = view.pan;
    this.draw();
  }

  getImagePixelAtCanvasPoint(xPx: number, yPx: number): ImagePixelPoint | null {
    if (!this.currentSource) return null;
    return convertCanvasPixelToImagePixelOrNull(this.buildCanvasToImagePixelInputs(xPx, yPx));
  }

  getImagePixelAtCanvasPointClamped(xPx: number, yPx: number): ImagePixelPoint | null {
    if (!this.currentSource) return null;
    return convertCanvasPixelToImagePixelClamped(this.buildCanvasToImagePixelInputs(xPx, yPx));
  }

  private buildCanvasToImagePixelInputs(xPx: number, yPx: number): CanvasToImagePixelInputs {
    return {
      canvasPointPx: { x: xPx, y: yPx },
      displaySize: this.displaySize,
      imageSize: this.imageSize,
      fitScale: computeFitToViewportScale(this.imageSize, this.displaySize),
      userZoom: this.userZoom,
      userPan: this.userPan,
    };
  }

  getCanvasPointForImagePixel(imageX: number, imageY: number): CanvasPixelPoint | null {
    if (!this.currentSource) return null;
    return convertImagePixelToCanvasPointOrNull({
      imagePixelPoint: { x: imageX, y: imageY },
      displaySize: this.displaySize,
      imageSize: this.imageSize,
      fitScale: computeFitToViewportScale(this.imageSize, this.displaySize),
      userZoom: this.userZoom,
      userPan: this.userPan,
    });
  }

  subscribeToViewTransformChanges(listener: () => void): () => void {
    this.viewTransformChangeListeners.add(listener);
    return () => {
      this.viewTransformChangeListeners.delete(listener);
    };
  }

  dispose(): void {
    this.detachContextLifecycleListeners();
    this.releaseAllWebGlResources();
  }

  private resetViewState(): void {
    this.userZoom = INITIAL_USER_ZOOM;
    this.userPan = IDENTITY_PAN;
  }

  private attachContextLifecycleListeners(): void {
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost, false);
    this.canvas.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
      false,
    );
  }

  private detachContextLifecycleListeners(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
  }

  private initializeWebGl(): void {
    const gl = this.canvas.getContext("webgl2", {
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.warn("[viewport] WebGL2 unavailable; viewport will be blank.");
      return;
    }
    this.gl = gl;
    reportHalfFloatExtensionMissingOnce(gl, this.options.onError);
    this.programResources = createViewportRendererProgram(gl);
    this.createAndRestoreToneCurveLutTextures(gl);
    this.applyViewportToCanvasSize();
    this.uploadCurrentSourceIfReady();
    this.draw();
  }

  private createAndRestoreToneCurveLutTextures(gl: WebGL2RenderingContext): void {
    this.toneCurveLutTexture = createIdentityToneCurveLutTexture(gl);
    this.toneCurveGreenLutTexture = createIdentityToneCurveLutTexture(gl);
    this.toneCurveBlueLutTexture = createIdentityToneCurveLutTexture(gl);
    this.toneCurveLutUploads = { unitOne: null, green: null, blue: null };
    this.uploadToneCurveLutTextures();
  }

  private respondToContextLost(event: Event): void {
    event.preventDefault();
    this.programResources = null;
    this.singleTexture = null;
    this.rasterTileTextures = [];
    this.toneCurveLutTexture = null;
    this.toneCurveGreenLutTexture = null;
    this.toneCurveBlueLutTexture = null;
    this.gl = null;
    console.warn("[viewport] WebGL context lost");
  }

  private respondToContextRestored(): void {
    console.info("[viewport] WebGL context restored; reinitializing.");
    this.initializeWebGl();
  }

  private uploadCurrentSourceIfReady(): void {
    if (!this.gl || !this.currentSource) return;
    this.releaseCurrentSourceTextures();
    recordImageTextureUpload();
    if (this.currentSource.kind === "raster") {
      this.rasterTileTextures = createRasterTileTexturesForSource(
        this.gl,
        this.currentSource.raster,
        this.selectedRasterBandIndex,
      );
      return;
    }
    this.singleTexture = createTextureFromBrowserSource(this.gl, this.currentSource);
  }

  private rebuildRasterTilesForSelectedBand(): void {
    if (!this.gl || !this.currentSource || this.currentSource.kind !== "raster") return;
    deleteRasterTileTexturesSafely(this.gl, this.rasterTileTextures);
    recordImageTextureUpload();
    this.rasterTileTextures = createRasterTileTexturesForSource(
      this.gl,
      this.currentSource.raster,
      this.selectedRasterBandIndex,
    );
  }

  private releaseCurrentSourceTextures(): void {
    if (!this.gl) return;
    deleteTextureSafely(this.gl, this.singleTexture);
    this.singleTexture = null;
    deleteRasterTileTexturesSafely(this.gl, this.rasterTileTextures);
    this.rasterTileTextures = [];
  }

  private applyViewportToCanvasSize(): void {
    if (!this.gl) return;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(): void {
    const { gl, programResources } = this;
    if (!gl || !programResources) return;
    clearCanvasToTransparentBlack(gl);
    const transform = this.computeCurrentQuadTransform();
    const renderState = this.snapshotCurrentRenderState();
    if (this.singleTexture) {
      drawSingleTextureWithTransform(gl, programResources, this.singleTexture, transform, renderState);
      this.notifyViewTransformChangeListeners();
      return;
    }
    if (this.rasterTileTextures.length > 0) {
      this.drawRasterTilesWithPerTileTransforms(gl, programResources, transform, renderState);
    }
    this.notifyViewTransformChangeListeners();
  }

  private notifyViewTransformChangeListeners(): void {
    for (const listener of this.viewTransformChangeListeners) listener();
  }

  private snapshotCurrentRenderState(): RenderPassState {
    return {
      normalization: this.resolveEffectiveNormalization(),
      isSingleBand: this.isSingleBandSource,
      toneCurve: this.snapshotToneCurvePassState(),
    };
  }

  private snapshotToneCurvePassState(): ToneCurvePassState {
    const multiChannel = this.toneCurveChannelLookupTables !== null;
    const hasPreview = this.toneCurveLookupTable !== null || multiChannel;
    return {
      enabled: hasPreview && this.toneCurveLutTexture !== null,
      multiChannel,
      redOrValueLutTexture: this.toneCurveLutTexture,
      greenLutTexture: this.toneCurveGreenLutTexture,
      blueLutTexture: this.toneCurveBlueLutTexture,
      sampleDomain: this.resolveToneCurveSampleDomain(),
    };
  }

  // CT-198: a single-band float band's LUT is built over its raw value extents, so the
  // shader must remap the raw sample into that domain. The extents are the same ones the
  // normalize/auto-fit block uses (computeImageRgbChannelExtents), so the LUT and the
  // shader agree on [dataMin, dataMax]. Integer/composite sources keep the disabled domain.
  private resolveToneCurveSampleDomain(): ToneCurveSampleDomain {
    if (!this.isSingleBandSource || !this.currentSourceIsFloatRaster()) {
      return DISABLED_TONE_CURVE_SAMPLE_DOMAIN;
    }
    return { remaps: true, min: this.normalization.extents.min[0], max: this.normalization.extents.max[0] };
  }

  private currentSourceIsFloatRaster(): boolean {
    return this.currentSource?.kind === "raster" && this.currentSource.raster.sampleFormat === "float";
  }

  // A float raster whose data lies outside [0, 1] would saturate to a flat white
  // frame under the fixed [0, 1] default window, so auto-fit its display window to
  // the data's own extents on open (CT-161). This is display-only: the user
  // toggle, pixel data, and History are untouched.
  private resolveEffectiveNormalization(): NormalizationState {
    return resolveEffectiveFloatDisplayNormalization(
      this.normalization,
      this.autoFitsFloatDisplayWindow,
    );
  }

  private drawRasterTilesWithPerTileTransforms(
    gl: WebGL2RenderingContext,
    programResources: RendererProgramResources,
    globalTransform: QuadTransform,
    renderState: RenderPassState,
  ): void {
    for (const tile of this.rasterTileTextures) {
      const tileTransform = composeTileQuadTransform(globalTransform, tile, this.imageSize);
      drawSingleTextureWithTransform(
        gl,
        programResources,
        tile.texture,
        tileTransform,
        renderState,
      );
    }
  }

  private computeCurrentQuadTransform(): QuadTransform {
    const fitScale = computeFitToViewportScale(this.imageSize, this.displaySize);
    return {
      scale: { x: fitScale.x * this.userZoom, y: fitScale.y * this.userZoom },
      translate: this.userPan,
    };
  }

  private releaseAllWebGlResources(): void {
    if (!this.gl) return;
    this.releaseCurrentSourceTextures();
    deleteTextureSafely(this.gl, this.toneCurveLutTexture);
    deleteTextureSafely(this.gl, this.toneCurveGreenLutTexture);
    deleteTextureSafely(this.gl, this.toneCurveBlueLutTexture);
    this.toneCurveLutTexture = null;
    this.toneCurveGreenLutTexture = null;
    this.toneCurveBlueLutTexture = null;
    deleteRendererProgramResources(this.gl, this.programResources);
    this.programResources = null;
    this.gl = null;
  }
}

let halfFloatExtensionWarningShown = false;

function reportHalfFloatExtensionMissingOnce(
  gl: WebGL2RenderingContext,
  onError: ((message: string) => void) | undefined,
): void {
  if (probeHalfFloatColorBufferExtension(gl)) return;
  if (halfFloatExtensionWarningShown) return;
  halfFloatExtensionWarningShown = true;
  if (onError) onError(HALF_FLOAT_UNSUPPORTED_MESSAGE);
  else console.warn(`[viewport] ${HALF_FLOAT_UNSUPPORTED_MESSAGE}`);
}

function clampBandIndexForSource(source: ViewportImageSource, bandIndex: number): number {
  if (source.kind !== "raster") return 0;
  return clampBandIndexToRaster(source.raster, bandIndex);
}

function isSingleBandSourceWithSelectedBand(source: ViewportImageSource): boolean {
  if (source.kind !== "raster") return false;
  return !shouldRenderRasterAsRgbComposite(source.raster);
}

function createRasterTileTexturesForSource(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
  bandIndex: number,
): RasterTileTexture[] {
  if (shouldRenderRasterAsRgbComposite(raster)) {
    return createRgbCompositeTileTextures(gl, raster);
  }
  return createRasterTileTexturesForRasterBand(gl, raster, bandIndex);
}

function createRasterTileTexturesForRasterBand(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
  bandIndex: number,
): RasterTileTexture[] {
  const rasterTiles = splitRasterBandIntoTiles(bandPixelGridForRaster(raster, bandIndex), DEFAULT_RASTER_TILE_SIZE);
  return rasterTiles.map((tile) => createSingleBandTextureForRasterTile(gl, tile, raster));
}

function createRgbCompositeTileTextures(
  gl: WebGL2RenderingContext,
  raster: RasterImage,
): RasterTileTexture[] {
  const [redTiles, greenTiles, blueTiles] = splitRgbCompositeBandsIntoAlignedTiles(raster);
  return redTiles.map((redTile, tileIndex) =>
    createRgbCompositeTextureForRasterTileTriple(gl, [redTile, greenTiles[tileIndex]!, blueTiles[tileIndex]!], raster),
  );
}

function splitRgbCompositeBandsIntoAlignedTiles(
  raster: RasterImage,
): readonly [readonly RasterTile[], readonly RasterTile[], readonly RasterTile[]] {
  return [
    splitRasterBandIntoTiles(bandPixelGridForRaster(raster, 0), DEFAULT_RASTER_TILE_SIZE),
    splitRasterBandIntoTiles(bandPixelGridForRaster(raster, 1), DEFAULT_RASTER_TILE_SIZE),
    splitRasterBandIntoTiles(bandPixelGridForRaster(raster, 2), DEFAULT_RASTER_TILE_SIZE),
  ];
}

function bandPixelGridForRaster(raster: RasterImage, bandIndex: number): RasterBandPixelGrid {
  return { pixels: getRasterBandPixelsOrThrow(raster, bandIndex), width: raster.width, height: raster.height };
}

function syncCanvasBackingResolution(
  canvas: HTMLCanvasElement,
  displayWidthPx: number,
  displayHeightPx: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.floor(displayWidthPx * dpr));
  const targetHeight = Math.max(1, Math.floor(displayHeightPx * dpr));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
}

function clearCanvasToTransparentBlack(gl: WebGL2RenderingContext): void {
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function drawSingleTextureWithTransform(
  gl: WebGL2RenderingContext,
  resources: RendererProgramResources,
  texture: WebGLTexture,
  transform: QuadTransform,
  renderState: RenderPassState,
): void {
  gl.useProgram(resources.program);
  applyQuadTransformUniforms(gl, resources.uniforms.quadTransform, transform);
  applyNormalizationUniforms(gl, resources.uniforms.normalization, renderState.normalization);
  applyBandModeUniforms(gl, resources.uniforms.bandMode, renderState.isSingleBand);
  applyToneCurveUniforms(gl, resources.uniforms.toneCurve, renderState.toneCurve);
  gl.bindVertexArray(resources.vao);
  bindToneCurveLutsToUnits(gl, renderState.toneCurve);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

function applyToneCurveUniforms(
  gl: WebGL2RenderingContext,
  uniforms: ToneCurveUniformLocations,
  toneCurve: ToneCurvePassState,
): void {
  if (uniforms.enabled !== null) {
    gl.uniform1i(uniforms.enabled, toneCurve.enabled ? 1 : 0);
  }
  if (uniforms.multiChannel !== null) {
    gl.uniform1i(uniforms.multiChannel, toneCurve.multiChannel ? 1 : 0);
  }
  applyToneCurveSampleDomainUniforms(gl, uniforms, toneCurve.sampleDomain);
}

function applyToneCurveSampleDomainUniforms(
  gl: WebGL2RenderingContext,
  uniforms: ToneCurveUniformLocations,
  sampleDomain: ToneCurveSampleDomain,
): void {
  if (uniforms.remapsSampleDomain !== null) {
    gl.uniform1i(uniforms.remapsSampleDomain, sampleDomain.remaps ? 1 : 0);
  }
  if (uniforms.sampleDomainMin !== null) gl.uniform1f(uniforms.sampleDomainMin, sampleDomain.min);
  if (uniforms.sampleDomainMax !== null) gl.uniform1f(uniforms.sampleDomainMax, sampleDomain.max);
}

function bindToneCurveLutsToUnits(
  gl: WebGL2RenderingContext,
  toneCurve: ToneCurvePassState,
): void {
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, toneCurve.redOrValueLutTexture);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, toneCurve.greenLutTexture);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, toneCurve.blueLutTexture);
}

function applyBandModeUniforms(
  gl: WebGL2RenderingContext,
  uniforms: BandModeUniformLocations,
  isSingleBand: boolean,
): void {
  if (uniforms.isSingleBand === null) return;
  gl.uniform1i(uniforms.isSingleBand, isSingleBand ? 1 : 0);
}

function applyQuadTransformUniforms(
  gl: WebGL2RenderingContext,
  uniforms: QuadTransformUniformLocations,
  transform: QuadTransform,
): void {
  if (uniforms.quadScale !== null) {
    gl.uniform2f(uniforms.quadScale, transform.scale.x, transform.scale.y);
  }
  if (uniforms.quadTranslate !== null) {
    gl.uniform2f(
      uniforms.quadTranslate,
      transform.translate.x,
      transform.translate.y,
    );
  }
}

function applyNormalizationUniforms(
  gl: WebGL2RenderingContext,
  uniforms: NormalizationUniformLocations,
  normalization: NormalizationState,
): void {
  if (uniforms.enabled !== null) {
    gl.uniform1i(uniforms.enabled, normalization.enabled ? 1 : 0);
  }
  applyVec3UniformFromTriple(gl, uniforms.minColor, normalization.extents.min);
  applyVec3UniformFromTriple(gl, uniforms.maxColor, normalization.extents.max);
}

function applyVec3UniformFromTriple(
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  triple: readonly [number, number, number],
): void {
  if (location === null) return;
  gl.uniform3f(location, triple[0], triple[1], triple[2]);
}

function createViewportRendererProgram(
  gl: WebGL2RenderingContext,
): RendererProgramResources {
  const program = compileAndLinkViewportProgram(gl);
  const vertexBuffer = createFullscreenQuadVertexBuffer(gl);
  const vao = createFullscreenQuadVertexArray(gl, vertexBuffer);
  bindTextureSamplerToUnitZero(gl, program);
  bindToneCurveLutSamplersToUnits(gl, program);
  const uniforms = lookUpProgramUniformLocations(gl, program);
  return { program, vao, vertexBuffer, uniforms };
}

function lookUpProgramUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): ProgramUniformLocations {
  return {
    quadTransform: lookUpQuadTransformUniformLocations(gl, program),
    normalization: lookUpNormalizationUniformLocations(gl, program),
    bandMode: lookUpBandModeUniformLocations(gl, program),
    toneCurve: lookUpToneCurveUniformLocations(gl, program),
  };
}

function lookUpToneCurveUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): ToneCurveUniformLocations {
  return {
    enabled: gl.getUniformLocation(program, "u_toneCurveEnabled"),
    multiChannel: gl.getUniformLocation(program, "u_toneCurveMultiChannel"),
    remapsSampleDomain: gl.getUniformLocation(program, "u_toneCurveRemapsSampleDomain"),
    sampleDomainMin: gl.getUniformLocation(program, "u_toneCurveSampleDomainMin"),
    sampleDomainMax: gl.getUniformLocation(program, "u_toneCurveSampleDomainMax"),
  };
}

function lookUpBandModeUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): BandModeUniformLocations {
  return {
    isSingleBand: gl.getUniformLocation(program, "u_isSingleBand"),
  };
}

function lookUpQuadTransformUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): QuadTransformUniformLocations {
  return {
    quadScale: gl.getUniformLocation(program, "u_quadScale"),
    quadTranslate: gl.getUniformLocation(program, "u_quadTranslate"),
  };
}

function lookUpNormalizationUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): NormalizationUniformLocations {
  return {
    enabled: gl.getUniformLocation(program, "u_normalizeEnabled"),
    minColor: gl.getUniformLocation(program, "u_normalizeMinColor"),
    maxColor: gl.getUniformLocation(program, "u_normalizeMaxColor"),
  };
}

function compileAndLinkViewportProgram(
  gl: WebGL2RenderingContext,
): WebGLProgram {
  const vertexShader = compileShaderOrThrow(
    gl,
    gl.VERTEX_SHADER,
    VIEWPORT_VERTEX_SHADER_SOURCE,
  );
  const fragmentShader = compileShaderOrThrow(
    gl,
    gl.FRAGMENT_SHADER,
    VIEWPORT_FRAGMENT_SHADER_SOURCE,
  );
  const program = linkProgramOrThrow(gl, vertexShader, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function createFullscreenQuadVertexBuffer(
  gl: WebGL2RenderingContext,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Failed to create vertex buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    FULLSCREEN_TEXTURED_QUAD_VERTICES,
    gl.STATIC_DRAW,
  );
  return buffer;
}

function createFullscreenQuadVertexArray(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("Failed to create vertex array object");
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  configureFullscreenQuadVertexAttributes(gl);
  gl.bindVertexArray(null);
  return vao;
}

function configureFullscreenQuadVertexAttributes(
  gl: WebGL2RenderingContext,
): void {
  enableInterleavedFloat2Attribute(gl, POSITION_ATTRIBUTE_LOCATION, 0);
  enableInterleavedFloat2Attribute(
    gl,
    TEXCOORD_ATTRIBUTE_LOCATION,
    2 * Float32Array.BYTES_PER_ELEMENT,
  );
}

function enableInterleavedFloat2Attribute(
  gl: WebGL2RenderingContext,
  location: number,
  offsetBytes: number,
): void {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(
    location,
    2,
    gl.FLOAT,
    false,
    VERTEX_STRIDE_BYTES,
    offsetBytes,
  );
}

function bindTextureSamplerToUnitZero(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): void {
  const samplerLocation = gl.getUniformLocation(program, "u_texture");
  if (!samplerLocation) return;
  gl.useProgram(program);
  gl.uniform1i(samplerLocation, 0);
  gl.useProgram(null);
}

function bindToneCurveLutSamplersToUnits(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): void {
  gl.useProgram(program);
  bindSamplerUniformToUnit(gl, program, "u_toneCurveLut", 1);
  bindSamplerUniformToUnit(gl, program, "u_toneCurveLutGreen", 2);
  bindSamplerUniformToUnit(gl, program, "u_toneCurveLutBlue", 3);
  gl.useProgram(null);
}

function bindSamplerUniformToUnit(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  samplerName: string,
  unit: number,
): void {
  const samplerLocation = gl.getUniformLocation(program, samplerName);
  if (!samplerLocation) return;
  gl.uniform1i(samplerLocation, unit);
}

function deleteRendererProgramResources(
  gl: WebGL2RenderingContext,
  resources: RendererProgramResources | null,
): void {
  if (!resources) return;
  gl.deleteProgram(resources.program);
  gl.deleteVertexArray(resources.vao);
  gl.deleteBuffer(resources.vertexBuffer);
}
