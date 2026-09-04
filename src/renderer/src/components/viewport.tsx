import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { MutableRefObject, RefObject } from "react";
import { Contrast, Eye, EyeOff, FolderOpen, Link2, X } from "lucide-react";
import { notifyError } from "@/lib/notifications/notify";

import { RgbCompositeIcon } from "@/components/rgb-composite-icon";
import { ViewportBandNavigator } from "@/components/viewport-band-navigator";
import { formatViewportHeaderLabel } from "@/components/viewport-header-label";
import { ViewportMaskBrushGhost } from "@/components/viewport-mask-brush-ghost";
import { ViewportMaskOverlay } from "@/components/viewport-mask-overlay";
import { ViewportRoiOverlay } from "@/components/viewport-roi-overlay";
import type { RasterImage } from "@/lib/image/raster-image";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import {
  canViewCompositeChannelsSeparately,
  resolveImageSourceForChannelView,
} from "@/lib/image/composite-channel-view";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readPixelReadoutBandsAtImagePointOrNull } from "@/lib/image/compute-pixel-readout";
import type { ClickedImagePixel } from "@/lib/image/roi-selection-lifecycle";
import {
  canonicalizeViewportRoiCorners,
  clampViewportRoiToImageBounds,
  isViewportRoiLargerThanMinimumSide,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import {
  listPixelIndexesUnderBrushSegment,
  resolveMaskBrushPaintValue,
  writeMaskValueAtPixelIndexes,
  type MaskBrushSegment,
  type MaskBrushSettings,
  type MaskImagePoint,
} from "@/lib/masks/mask-brush";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import {
  attachMaskBrushEventHandlers,
  type MaskBrushAttachment,
  type MaskBrushCallbacks,
  type MaskBrushCanvasSegment,
} from "@/lib/webgl/mask-brush-input";
import type { CanvasPixelPoint } from "@/lib/webgl/canvas-to-image-pixel";
import { attachBrushGhostHoverEventHandlers } from "@/lib/webgl/brush-ghost-hover-input";
import { attachPanZoomEventHandlers } from "@/lib/webgl/pan-zoom-input";
import { attachPixelClickEventHandlers } from "@/lib/webgl/pixel-click-input";
import {
  attachPointerReadoutEventHandlers,
  type CanvasCursorPositionPx,
} from "@/lib/webgl/pointer-readout-input";
import {
  attachRoiBoxEditEventHandlers,
} from "@/lib/webgl/roi-box-edit-input";
import {
  attachRoiDrawEventHandlers,
  type RoiDrawAttachment,
  type RoiDrawCanvasRect,
} from "@/lib/webgl/roi-draw-input";
import { getImageSourceDimensions, type ViewportImageSource } from "@/lib/webgl/texture";
import { ViewportRenderer } from "@/lib/webgl/viewport-renderer";
import { getViewportIndexFromNumber } from "@/lib/grid/grid-layout";
import type { PanelSize } from "@/lib/grid/panel-link-groups";
import { usePanelLink, type PanelLinkApi, type PanelLinkTarget } from "@/state/panel-link-context";
import type { ToneCurveChannelPreviewLuts } from "@/lib/image/tone-curve-composite-preview";
import {
  usePixelReadoutPublisher,
  type PixelReadoutPublisher,
  type ViewportPixelReadoutSnapshot,
} from "@/state/pixel-readout-context";

// CT-342: the mask layer the panel DRAWS, null whenever the panel's overlay is
// switched off or no selected layer covers the stack. It is independent of the
// brush below: a visible overlay does not imply a painting panel.
export interface ViewportMaskOverlaySelection {
  readonly layer: MaskLayer;
}

// CT-304: what the panel needs to PAINT the selected mask layer. It is null
// whenever the Masks tool is off, the panel is not selected, or no layer is
// selected, which is exactly when the brush should not exist.
export interface ViewportMaskPainting {
  readonly layer: MaskLayer;
  readonly brush: MaskBrushSettings;
  readonly onCommitStrokeValues: (values: Uint8Array) => void;
}

interface ViewportProps {
  imageSource?: ViewportImageSource | null;
  previewImageSource?: ViewportImageSource | null;
  toneCurvePreviewLookupTable?: ReadonlyArray<number> | null;
  toneCurvePreviewChannelLookupTables?: ToneCurveChannelPreviewLuts | null;
  fileName?: string | null;
  viewportNumber?: number | null;
  normalizationEnabled: boolean;
  onToggleNormalizedViewing: () => void;
  showMaskOverlayToggle: boolean;
  maskOverlayVisible: boolean;
  onToggleMaskOverlayVisibility: () => void;
  viewChannelsSeparately: boolean;
  onToggleViewChannelsSeparately: () => void;
  selectedBandIndex: number;
  onSelectBandIndex: (bandIndex: number) => void;
  onRemoveBand?: (bandIndex: number) => void;
  lastAppliedOperationLabel?: string | null;
  isRegionToolActive: boolean;
  roi: ViewportRoi | null;
  onCommitRoi: (roi: ViewportRoi) => void;
  canEditCommittedRoi: boolean;
  onPreviewRoiEdit: (roi: ViewportRoi | null) => void;
  onCommitRoiEdit: (roi: ViewportRoi) => void;
  onRegionToolPlainClick: (clickedImagePixel: ClickedImagePixel | null) => void;
  maskOverlay?: ViewportMaskOverlaySelection | null;
  maskPainting?: ViewportMaskPainting | null;
  onPinPixelSpectrum: (imageX: number, imageY: number) => void;
  onOpenImage: () => void;
  onClose?: () => void;
}

export function Viewport(props: ViewportProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readoutContainerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const roiDrawAttachmentRef = useRef<RoiDrawAttachment | null>(null);
  const maskBrushAttachmentRef = useRef<MaskBrushAttachment | null>(null);
  const compositeSource = props.imageSource ?? null;
  const imageSource = resolveImageSourceForChannelView(
    compositeSource,
    props.viewChannelsSeparately,
  );
  const isChannelViewActive = imageSource !== compositeSource;
  const displaySource = props.previewImageSource ?? imageSource;
  const viewportAriaLabel = describeViewportAriaLabel(props.viewportNumber);
  const [inProgressDragRect, setInProgressDragRect] = useState<RoiDrawCanvasRect | null>(null);
  const [inProgressEditRoi, setInProgressEditRoi] = useState<ViewportRoi | null>(null);

  const panelLink = usePanelLink();
  const linkGroupIndex = panelLinkGroupIndexOrNull(props.viewportNumber);
  useViewportRendererLifecycle(canvasRef, rendererRef);
  useLinkedViewSynchronization(rendererRef, panelLink, linkGroupIndex, imageSource);
  useImageSourceUploadEffect(rendererRef, displaySource, props.selectedBandIndex);
  useSelectedBandIndexEffect(rendererRef, displaySource, props.selectedBandIndex);
  useNormalizationToggleEffect(rendererRef, props.normalizationEnabled);
  useToneCurvePreviewLutEffect(rendererRef, props.toneCurvePreviewLookupTable ?? null);
  useToneCurvePreviewChannelLutsEffect(rendererRef, props.toneCurvePreviewChannelLookupTables ?? null);
  useCanvasResizeObserverEffect(canvasRef, rendererRef);
  // CT-304: registered FIRST of all the pointer attachments. A brush stroke
  // claims the gesture outright, so painting can never also move the committed
  // region box, start a region draw, or pan the view.
  const maskStroke = useViewportMaskBrushAttachment(
    canvasRef,
    maskBrushAttachmentRef,
    rendererRef,
    props.maskPainting ?? null,
  );
  useDiscardInProgressStrokeWhenPaintingStops(maskBrushAttachmentRef, props.maskPainting ?? null);
  // CT-275: registered BEFORE the pan-zoom and draw attachments so a pointer-down
  // on the committed box claims the gesture ahead of both.
  useViewportRoiBoxEditing(canvasRef, {
    canEditCommittedRoi: props.canEditCommittedRoi,
    committedRoi: props.roi,
    imageSource,
    rendererRef,
    onPreviewRoiEdit: props.onPreviewRoiEdit,
    onCommitRoiEdit: props.onCommitRoiEdit,
    setInProgressEditRoi,
  });
  useViewportPanZoomInteractions(canvasRef, rendererRef, props.isRegionToolActive);
  useViewportPixelReadoutPublisher(readoutContainerRef, canvasRef, rendererRef, {
    viewportNumber: props.viewportNumber ?? null,
    imageSource,
    selectedBandIndex: props.selectedBandIndex,
  });
  useViewportRoiDrawAttachment(canvasRef, roiDrawAttachmentRef, {
    isRegionToolActive: props.isRegionToolActive,
    imageSource,
    rendererRef,
    onCommitRoi: props.onCommitRoi,
    onRegionToolPlainClick: props.onRegionToolPlainClick,
    setInProgressDragRect,
  });
  useDiscardInProgressDragWhenRegionToolDeactivates(
    roiDrawAttachmentRef,
    props.isRegionToolActive,
  );
  useViewportPixelClickPinAttachment(canvasRef, {
    isRegionToolActive: props.isRegionToolActive,
    imageSource,
    rendererRef,
    onPinPixelSpectrum: props.onPinPixelSpectrum,
  });
  const transformVersion = useRendererViewTransformVersion(rendererRef);
  const hoveredBrushPixel = useMaskBrushHoverImagePixel(
    canvasRef,
    rendererRef,
    props.maskPainting ?? null,
  );
  const isLinkedForPanZoom = linkGroupIndex !== null && panelLink.isPanelLinked(linkGroupIndex);
  const cursorClassName = shouldShowCrosshairCursor(props) ? "cursor-crosshair" : "";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-md border bg-card">
      <ViewportHeaderStrip
        viewportNumber={props.viewportNumber ?? null}
        fileName={props.fileName ?? null}
        isLinkedForPanZoom={isLinkedForPanZoom}
        raster={getRasterFromSourceOrNull(imageSource)}
        selectedBandIndex={props.selectedBandIndex}
        lastAppliedOperationLabel={props.lastAppliedOperationLabel ?? null}
        normalizationEnabled={props.normalizationEnabled}
        onToggleNormalizedViewing={props.onToggleNormalizedViewing}
        showNormalizedViewingToggle={imageSource !== null}
        showMaskOverlayToggle={props.showMaskOverlayToggle}
        maskOverlayVisible={props.maskOverlayVisible}
        onToggleMaskOverlayVisibility={props.onToggleMaskOverlayVisibility}
        showChannelViewToggle={canViewCompositeChannelsSeparately(compositeSource)}
        channelViewEnabled={isChannelViewActive}
        onToggleChannelView={props.onToggleViewChannelsSeparately}
        onClose={props.onClose ?? null}
        // CT-269: onClose is only provided for closable panels (content, or an
        // empty cell reserved by an in-flight apply, whose close cancels it).
        showCloseButton={Boolean(props.onClose)}
      />
      <div ref={readoutContainerRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className={`block h-full w-full touch-none select-none ${cursorClassName}`}
          aria-label={viewportAriaLabel}
        />
        <ViewportMaskOverlay
          renderer={rendererRef.current}
          layer={props.maskOverlay?.layer ?? null}
          values={maskStroke.values}
          transformVersion={transformVersion}
          paintVersion={maskStroke.paintVersion}
        />
        {props.maskPainting ? (
          <ViewportMaskBrushGhost
            renderer={rendererRef.current}
            hoveredImagePixel={hoveredBrushPixel}
            brushSizePx={props.maskPainting.brush.brushSizePx}
            transformVersion={transformVersion}
          />
        ) : null}
        <ViewportRoiOverlay
          renderer={rendererRef.current}
          committedRoi={inProgressEditRoi ?? props.roi}
          inProgressDragRect={inProgressDragRect}
          transformVersion={transformVersion}
        />
        {shouldShowBandNavigator(imageSource) ? (
          <ViewportBandNavigator
            bandCount={getMultiBandSourceBandCount(imageSource)}
            selectedBandIndex={props.selectedBandIndex}
            onSelectBandIndex={props.onSelectBandIndex}
            onRemoveBand={isChannelViewActive ? undefined : props.onRemoveBand}
          />
        ) : null}
        {imageSource === null ? <ViewportEmptyState onOpenImage={props.onOpenImage} /> : null}
      </div>
    </div>
  );
}

function ViewportEmptyState({ onOpenImage }: { onOpenImage: () => void }): JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
      <p className="text-sm text-muted-foreground">No stack loaded</p>
      <Button variant="outline" size="sm" onClick={onOpenImage}>
        <FolderOpen className="size-4" />
        Open image
      </Button>
    </div>
  );
}

function describeViewportAriaLabel(viewportNumber: number | null | undefined): string {
  if (typeof viewportNumber === "number") return `Panel ${viewportNumber}`;
  return "Image panel";
}

function shouldShowBandNavigator(source: ViewportImageSource | null): boolean {
  if (isTrueColorImageSource(source)) return false;
  return getMultiBandSourceBandCount(source) > 1;
}

// CT-159 option B: a true-colour image is presented as one colour image, not a
// stack of channels, so its R/G/B are never offered for per-band navigation.
function isTrueColorImageSource(source: ViewportImageSource | null): boolean {
  if (!source || source.kind !== "raster") return false;
  return shouldRenderRasterAsRgbComposite(source.raster);
}

function getMultiBandSourceBandCount(source: ViewportImageSource | null): number {
  if (!source || source.kind !== "raster") return 0;
  return source.raster.bandCount;
}

function getRasterFromSourceOrNull(source: ViewportImageSource | null): RasterImage | null {
  if (!source || source.kind !== "raster") return null;
  return source.raster;
}

interface ViewportHeaderStripProps {
  viewportNumber: number | null;
  fileName: string | null;
  isLinkedForPanZoom: boolean;
  raster: RasterImage | null;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
  normalizationEnabled: boolean;
  onToggleNormalizedViewing: () => void;
  showNormalizedViewingToggle: boolean;
  showMaskOverlayToggle: boolean;
  maskOverlayVisible: boolean;
  onToggleMaskOverlayVisibility: () => void;
  showChannelViewToggle: boolean;
  channelViewEnabled: boolean;
  onToggleChannelView: () => void;
  onClose: (() => void) | null;
  showCloseButton: boolean;
}

// The header sits ABOVE the cell's busy overlay (z-20 over its z-10): while an
// operation runs, the CT-269 close-the-target-cancels-the-run interaction needs
// the close button to stay clickable instead of being swallowed by the overlay.
function ViewportHeaderStrip(props: ViewportHeaderStripProps): JSX.Element {
  return (
    <div className="relative z-20 flex h-8 shrink-0 items-center gap-2 border-b bg-card px-2 text-xs">
      {typeof props.viewportNumber === "number" ? (
        <ViewportNumberBadge viewportNumber={props.viewportNumber} />
      ) : null}
      {props.fileName ? (
        <ViewportFileNameLabel
          fileName={props.fileName}
          raster={props.raster}
          selectedBandIndex={props.selectedBandIndex}
          lastAppliedOperationLabel={props.lastAppliedOperationLabel}
        />
      ) : null}
      {props.isLinkedForPanZoom ? <ViewportLinkedBadge /> : null}
      {props.showNormalizedViewingToggle ? (
        <NormalizedViewingToggleButton
          enabled={props.normalizationEnabled}
          onToggle={props.onToggleNormalizedViewing}
        />
      ) : null}
      {props.showMaskOverlayToggle ? (
        <MaskOverlayToggleButton
          enabled={props.maskOverlayVisible}
          onToggle={props.onToggleMaskOverlayVisibility}
        />
      ) : null}
      {props.showChannelViewToggle ? (
        <ChannelViewToggleButton
          enabled={props.channelViewEnabled}
          onToggle={props.onToggleChannelView}
        />
      ) : null}
      {props.showCloseButton && props.onClose ? (
        <ViewportCloseButton viewportNumber={props.viewportNumber} onClose={props.onClose} />
      ) : null}
    </div>
  );
}

interface NormalizedViewingToggleButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

function NormalizedViewingToggleButton(props: NormalizedViewingToggleButtonProps): JSX.Element {
  const label = props.enabled ? "Normalized viewing (on)" : "Normalized viewing";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("ml-auto size-6", props.enabled && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
          aria-label={label}
          aria-pressed={props.enabled}
          onClick={stopPropagationThenToggle(props.onToggle)}
        >
          <Contrast className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface MaskOverlayToggleButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

// CT-343: same shape as NormalizedViewingToggleButton (ghost icon Button,
// primary tint when on, aria-pressed, tooltip mirroring the label) so a mask
// can be shown or hidden without opening the Masks tool.
function MaskOverlayToggleButton(props: MaskOverlayToggleButtonProps): JSX.Element {
  const label = props.enabled ? "Show masks (on)" : "Show masks";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6", props.enabled && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
          aria-label={label}
          aria-pressed={props.enabled}
          onClick={stopPropagationThenToggle(props.onToggle)}
        >
          {props.enabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function stopPropagationThenToggle(
  onToggle: () => void,
): (event: MouseEvent<HTMLButtonElement>) => void {
  return (event) => {
    event.stopPropagation();
    onToggle();
  };
}

// CT-248/CT-295: a true-colour photo can be flipped into a display-only channel
// view where its R/G/B scroll like a scientific stack. The toggle carries the
// stable "RGB color composite" name (CT-259 pattern: aria-label never changes,
// aria-pressed carries the state) and the RgbCompositeIcon venn glyph, shared on
// purpose with the RGB Color Composite operation (same meaning, one icon).
interface ChannelViewToggleButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

const RGB_COMPOSITE_TOGGLE_LABEL = "RGB color composite";
const RGB_COMPOSITE_SHOWN_TOOLTIP =
  "Showing the 3 channels as one color image. Click to view each channel separately.";
const CHANNELS_SHOWN_TOOLTIP =
  "Showing each channel separately. Click to view as one RGB color image.";

function ChannelViewToggleButton(props: ChannelViewToggleButtonProps): JSX.Element {
  const tooltip = props.enabled ? CHANNELS_SHOWN_TOOLTIP : RGB_COMPOSITE_SHOWN_TOOLTIP;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6", props.enabled && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
          aria-label={RGB_COMPOSITE_TOGGLE_LABEL}
          aria-pressed={!props.enabled}
          onClick={stopPropagationThenToggle(props.onToggle)}
        >
          <RgbCompositeIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

interface ViewportCloseButtonProps {
  viewportNumber: number | null;
  onClose: () => void;
}

function ViewportCloseButton(props: ViewportCloseButtonProps): JSX.Element {
  const label = formatCloseButtonLabel(props.viewportNumber);
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    props.onClose();
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={label}
          onClick={handleClick}
        >
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function formatCloseButtonLabel(viewportNumber: number | null): string {
  if (typeof viewportNumber === "number") return `Close panel ${viewportNumber}`;
  return "Close panel";
}

interface ViewportFileNameLabelProps {
  fileName: string;
  raster: RasterImage | null;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
}

function ViewportFileNameLabel(props: ViewportFileNameLabelProps): JSX.Element {
  const display = formatViewportHeaderLabel({
    fileName: props.fileName,
    raster: props.raster,
    selectedBandIndex: props.selectedBandIndex,
    lastAppliedOperationLabel: props.lastAppliedOperationLabel,
  });
  return (
    <span className="truncate font-medium text-foreground" title={display}>
      {display}
    </span>
  );
}

function ViewportNumberBadge({
  viewportNumber,
}: {
  viewportNumber: number;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded border bg-background px-1 text-xs font-medium text-muted-foreground"
    >
      {viewportNumber}
    </span>
  );
}

// CT-207: a small badge showing this panel's pan/zoom is linked to peers.
function ViewportLinkedBadge(): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex items-center text-primary"
          aria-label="Linked pan and zoom"
        >
          <Link2 className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Linked pan and zoom</TooltipContent>
    </Tooltip>
  );
}

function panelLinkGroupIndexOrNull(viewportNumber: number | null | undefined): number | null {
  if (typeof viewportNumber !== "number") return null;
  return getViewportIndexFromNumber(viewportNumber);
}

// CT-207: register this panel's renderer as a link target and broadcast its view
// transform to linked peers whenever a gesture moves it.
function useLinkedViewSynchronization(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  panelLink: PanelLinkApi,
  linkGroupIndex: number | null,
  imageSource: ViewportImageSource | null,
): void {
  const panelLinkRef = useLatestValueRef(panelLink);
  const imageSourceRef = useLatestValueRef(imageSource);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || linkGroupIndex === null) return;
    return attachLinkedViewSynchronization(renderer, panelLinkRef.current, linkGroupIndex, imageSourceRef);
    // rendererRef is stable; latest-value refs hold the dynamic api and source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkGroupIndex]);
}

function attachLinkedViewSynchronization(
  renderer: ViewportRenderer,
  panelLink: PanelLinkApi,
  linkGroupIndex: number,
  imageSourceRef: MutableRefObject<ViewportImageSource | null>,
): () => void {
  const unregister = panelLink.registerLinkTarget(
    linkGroupIndex,
    buildLinkTargetForRenderer(renderer, imageSourceRef),
  );
  const unsubscribe = renderer.subscribeToViewTransformChanges(() =>
    panelLink.notifyPanelViewTransformChanged(linkGroupIndex),
  );
  return () => {
    unregister();
    unsubscribe();
  };
}

function buildLinkTargetForRenderer(
  renderer: ViewportRenderer,
  imageSourceRef: MutableRefObject<ViewportImageSource | null>,
): PanelLinkTarget {
  return {
    getUserView: () => renderer.getUserView(),
    applyUserView: (view) => renderer.applyUserView(view),
    getPanelSize: () => readPanelSizeFromSourceOrNull(imageSourceRef.current),
  };
}

function readPanelSizeFromSourceOrNull(source: ViewportImageSource | null): PanelSize | null {
  return source ? getImageSourceDimensions(source) : null;
}

function useViewportRendererLifecycle(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new ViewportRenderer(canvasRef.current, {
      onError: showRendererErrorToast,
    });
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // canvasRef and rendererRef are stable refs; effect must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function showRendererErrorToast(message: string): void {
  notifyError(message);
}

function useImageSourceUploadEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  source: ViewportImageSource | null,
  selectedBandIndex: number,
): void {
  useEffect(() => {
    if (source === null) return;
    rendererRef.current?.setImageSource(source, selectedBandIndex);
    // Re-uploading on bandIndex change is handled by useSelectedBandIndexEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererRef, source]);
}

function useSelectedBandIndexEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  source: ViewportImageSource | null,
  selectedBandIndex: number,
): void {
  useEffect(() => {
    if (source === null || source.kind !== "raster") return;
    rendererRef.current?.setSelectedRasterBandIndex(selectedBandIndex);
  }, [rendererRef, source, selectedBandIndex]);
}

function useNormalizationToggleEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    rendererRef.current?.setNormalizationEnabled(enabled);
  }, [rendererRef, enabled]);
}

// CT-171: drive the display-only tone-curve preview. A non-null LUT enables the
// shader's tone-curve branch; null clears it (byte-for-byte identical to no
// curve), so closing the panel or clearing anchors restores the untouched source.
function useToneCurvePreviewLutEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  lookupTable: ReadonlyArray<number> | null,
): void {
  useEffect(() => {
    rendererRef.current?.setToneCurveLookupTable(lookupTable);
  }, [rendererRef, lookupTable]);
}

// CT-177: drive the composite per-channel tone-curve preview. A non-null triple
// puts the shader into multi-channel mode (each R/G/B samples its own LUT); null
// reverts to the single-LUT (or no) preview from CT-171.
function useToneCurvePreviewChannelLutsEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  channelLookupTables: ToneCurveChannelPreviewLuts | null,
): void {
  useEffect(() => {
    rendererRef.current?.setToneCurveChannelLookupTables(channelLookupTables);
  }, [rendererRef, channelLookupTables]);
}

function useCanvasResizeObserverEffect(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) =>
      forwardResizeEntriesToRenderer(entries, rendererRef),
    );
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function forwardResizeEntriesToRenderer(
  entries: ReadonlyArray<ResizeObserverEntry>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  const entry = entries[0];
  if (!entry || !rendererRef.current) return;
  const { width, height } = entry.contentRect;
  rendererRef.current.resizeToDisplaySize(width, height);
}

function useViewportPanZoomInteractions(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  isRegionToolActive: boolean,
): void {
  const isRegionToolActiveRef = useLatestValueRef(isRegionToolActive);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachPanZoomEventHandlers(
      canvas,
      () => rendererRef.current,
      () => !isRegionToolActiveRef.current,
    );
    // canvasRef and rendererRef are stable refs; latest-value ref holds the toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface ViewportPixelReadoutInputs {
  viewportNumber: number | null;
  imageSource: ViewportImageSource | null;
  selectedBandIndex: number;
}

function useViewportPixelReadoutPublisher(
  containerRef: RefObject<HTMLElement>,
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  inputs: ViewportPixelReadoutInputs,
): void {
  const publishReadoutSnapshot = usePixelReadoutPublisher();
  const inputsRef = useLatestValueRef(inputs);
  const publisherRef = useLatestValueRef(publishReadoutSnapshot);
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    return attachPointerReadoutEventHandlers(container, canvas, {
      onMove: (cursor) => publishReadoutSnapshotForCursor(cursor, rendererRef, inputsRef, publisherRef),
      onLeave: () => publisherRef.current(null),
    });
    // containerRef, canvasRef, rendererRef are stable refs; latest-value refs hold dynamic inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useLatestValueRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function publishReadoutSnapshotForCursor(
  cursor: CanvasCursorPositionPx,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  inputsRef: MutableRefObject<ViewportPixelReadoutInputs>,
  publisherRef: MutableRefObject<PixelReadoutPublisher>,
): void {
  const snapshot = buildPixelReadoutSnapshotForCursorOrNull(cursor, rendererRef.current, inputsRef.current);
  publisherRef.current(snapshot);
}

function buildPixelReadoutSnapshotForCursorOrNull(
  cursor: CanvasCursorPositionPx,
  renderer: ViewportRenderer | null,
  inputs: ViewportPixelReadoutInputs,
): ViewportPixelReadoutSnapshot | null {
  if (!renderer || !inputs.imageSource || inputs.viewportNumber === null) return null;
  const imagePixel = renderer.getImagePixelAtCanvasPoint(cursor.xPx, cursor.yPx);
  if (!imagePixel) return null;
  return {
    viewportNumber: inputs.viewportNumber,
    imagePixelX: imagePixel.x,
    imagePixelY: imagePixel.y,
    selectedBandIndex: inputs.selectedBandIndex,
    bands: readPixelReadoutBandsAtImagePointOrNull(inputs.imageSource, imagePixel.x, imagePixel.y),
    bandCount: countSourceBandsForReadout(inputs.imageSource),
  };
}

function countSourceBandsForReadout(source: ViewportImageSource): number {
  if (source.kind === "raster") return source.raster.bandCount;
  return 0;
}

// CT-275: attach the committed-box move/resize handlers. The local preview state
// drives the overlay while the drag is in flight; the preview callback also feeds
// the region-edit-preview context so coordinate readouts track the box live.
interface ViewportRoiBoxEditInputs {
  readonly canEditCommittedRoi: boolean;
  readonly committedRoi: ViewportRoi | null;
  readonly imageSource: ViewportImageSource | null;
  readonly rendererRef: MutableRefObject<ViewportRenderer | null>;
  readonly onPreviewRoiEdit: (roi: ViewportRoi | null) => void;
  readonly onCommitRoiEdit: (roi: ViewportRoi) => void;
  readonly setInProgressEditRoi: (roi: ViewportRoi | null) => void;
}

function useViewportRoiBoxEditing(
  canvasRef: RefObject<HTMLCanvasElement>,
  inputs: ViewportRoiBoxEditInputs,
): void {
  const inputsRef = useLatestValueRef(inputs);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const attachment = attachRoiBoxEditEventHandlers(
      canvas,
      buildRoiBoxEditCallbacksFromInputsRef(inputsRef),
    );
    return () => attachment.detach();
    // canvasRef is stable; latest-value ref holds dynamic inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function buildRoiBoxEditCallbacksFromInputsRef(
  inputsRef: MutableRefObject<ViewportRoiBoxEditInputs>,
): Parameters<typeof attachRoiBoxEditEventHandlers>[1] {
  return {
    isRoiBoxEditingEnabled: () =>
      inputsRef.current.canEditCommittedRoi &&
      inputsRef.current.committedRoi !== null &&
      inputsRef.current.imageSource !== null,
    getCommittedRoi: () => inputsRef.current.committedRoi,
    getRenderer: () => inputsRef.current.rendererRef.current,
    getImageExtents: () => readImageExtentsFromSourceOrNull(inputsRef.current.imageSource),
    onPreviewRoiEdit: (roi) => {
      inputsRef.current.setInProgressEditRoi(roi);
      inputsRef.current.onPreviewRoiEdit(roi);
    },
    onCommitRoiEdit: (roi) => inputsRef.current.onCommitRoiEdit(roi),
  };
}

function readImageExtentsFromSourceOrNull(
  source: ViewportImageSource | null,
): { width: number; height: number } | null {
  if (!source) return null;
  return getImageSourceDimensions(source);
}

interface ViewportRoiDrawInputs {
  readonly isRegionToolActive: boolean;
  readonly imageSource: ViewportImageSource | null;
  readonly rendererRef: MutableRefObject<ViewportRenderer | null>;
  readonly onCommitRoi: (roi: ViewportRoi) => void;
  readonly onRegionToolPlainClick: (clickedImagePixel: ClickedImagePixel | null) => void;
  readonly setInProgressDragRect: (rect: RoiDrawCanvasRect | null) => void;
}

function useViewportRoiDrawAttachment(
  canvasRef: RefObject<HTMLCanvasElement>,
  attachmentRef: MutableRefObject<RoiDrawAttachment | null>,
  inputs: ViewportRoiDrawInputs,
): void {
  const inputsRef = useLatestValueRef(inputs);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const attachment = attachRoiDrawEventHandlers(canvas, {
      isRoiDrawingEnabled: () => isRoiDrawingEnabledFromInputs(inputsRef.current),
      onDragStateChange: (rect) => inputsRef.current.setInProgressDragRect(rect),
      onDragCommit: (rect) => commitRoiFromCanvasRect(rect, inputsRef.current),
    });
    attachmentRef.current = attachment;
    return () => {
      attachmentRef.current = null;
      attachment.detach();
    };
    // canvasRef is stable; latest-value ref holds dynamic inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useDiscardInProgressDragWhenRegionToolDeactivates(
  attachmentRef: MutableRefObject<RoiDrawAttachment | null>,
  isRegionToolActive: boolean,
): void {
  useEffect(() => {
    if (isRegionToolActive) return;
    attachmentRef.current?.cancelInProgressDrag();
  }, [attachmentRef, isRegionToolActive]);
}

function isRoiDrawingEnabledFromInputs(inputs: ViewportRoiDrawInputs): boolean {
  return inputs.isRegionToolActive && inputs.imageSource !== null;
}

const MINIMUM_DRAG_DISTANCE_FOR_COMMIT_PX = 3;

function commitRoiFromCanvasRect(
  rect: RoiDrawCanvasRect,
  inputs: ViewportRoiDrawInputs,
): void {
  const renderer = inputs.rendererRef.current;
  const source = inputs.imageSource;
  if (!renderer || !source) return;
  if (isCanvasDragLargerThanClickThreshold(rect)) {
    commitRoiFromLargeDrag(rect, renderer, source, inputs);
    return;
  }
  reportRegionToolPlainClick(rect, renderer, inputs);
}

function commitRoiFromLargeDrag(
  rect: RoiDrawCanvasRect,
  renderer: ViewportRenderer,
  source: ViewportImageSource,
  inputs: ViewportRoiDrawInputs,
): void {
  const startImagePixel = renderer.getImagePixelAtCanvasPoint(rect.start.x, rect.start.y);
  const endImagePixel = renderer.getImagePixelAtCanvasPoint(rect.current.x, rect.current.y);
  if (!startImagePixel || !endImagePixel) return;
  const candidate = clampViewportRoiToImageBounds(
    {
      imagePixelX0: startImagePixel.x,
      imagePixelY0: startImagePixel.y,
      imagePixelX1: endImagePixel.x,
      imagePixelY1: endImagePixel.y,
    },
    getImageSourceDimensions(source),
  );
  const canonical = canonicalizeViewportRoiCorners(candidate);
  if (!isViewportRoiLargerThanMinimumSide(canonical)) return;
  inputs.onCommitRoi(canonical);
}

function reportRegionToolPlainClick(
  rect: RoiDrawCanvasRect,
  renderer: ViewportRenderer,
  inputs: ViewportRoiDrawInputs,
): void {
  const imagePixel = renderer.getImagePixelAtCanvasPoint(rect.start.x, rect.start.y);
  inputs.onRegionToolPlainClick(imagePixel ?? null);
}

function isCanvasDragLargerThanClickThreshold(rect: RoiDrawCanvasRect): boolean {
  const widthPx = Math.abs(rect.current.x - rect.start.x);
  const heightPx = Math.abs(rect.current.y - rect.start.y);
  return widthPx >= MINIMUM_DRAG_DISTANCE_FOR_COMMIT_PX
    || heightPx >= MINIMUM_DRAG_DISTANCE_FOR_COMMIT_PX;
}

interface ViewportPixelClickPinInputs {
  readonly isRegionToolActive: boolean;
  readonly imageSource: ViewportImageSource | null;
  readonly rendererRef: MutableRefObject<ViewportRenderer | null>;
  readonly onPinPixelSpectrum: (imageX: number, imageY: number) => void;
}

function useViewportPixelClickPinAttachment(
  canvasRef: RefObject<HTMLCanvasElement>,
  inputs: ViewportPixelClickPinInputs,
): void {
  const inputsRef = useLatestValueRef(inputs);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachPixelClickEventHandlers(canvas, {
      isPixelClickEnabled: () => isPixelClickPinEnabledFromInputs(inputsRef.current),
      onPixelClick: (point) => pinPixelSpectrumFromCanvasPoint(point, inputsRef.current),
    });
    // canvasRef is stable; latest-value ref holds dynamic inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function isPixelClickPinEnabledFromInputs(inputs: ViewportPixelClickPinInputs): boolean {
  if (inputs.isRegionToolActive) return false;
  if (!inputs.imageSource || inputs.imageSource.kind !== "raster") return false;
  return inputs.imageSource.raster.bandCount > 1;
}

function pinPixelSpectrumFromCanvasPoint(
  point: { x: number; y: number },
  inputs: ViewportPixelClickPinInputs,
): void {
  const renderer = inputs.rendererRef.current;
  if (!renderer) return;
  const imagePixel = renderer.getImagePixelAtCanvasPoint(point.x, point.y);
  if (!imagePixel) return;
  inputs.onPinPixelSpectrum(imagePixel.x, imagePixel.y);
}

function useRendererViewTransformVersion(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    return renderer.subscribeToViewTransformChanges(() => {
      setVersion((current) => current + 1);
    });
    // rendererRef is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return version;
}

function shouldShowCrosshairCursor(props: ViewportProps): boolean {
  return props.isRegionToolActive || Boolean(props.maskPainting);
}

// CT-304: an in-progress stroke paints into a PRIVATE copy of the layer's values
// (one allocation per stroke, not per pointer sample) and only commits it to the
// panel's rendering state on release. `paintVersion` is what tells the overlay to
// repaint, since the buffer's identity never changes while the stroke runs.
interface MaskStrokeSnapshot {
  readonly values: Uint8Array | null;
  readonly paintVersion: number;
}

const NO_MASK_STROKE: MaskStrokeSnapshot = { values: null, paintVersion: 0 };

type MaskStrokeSetter = (update: (previous: MaskStrokeSnapshot) => MaskStrokeSnapshot) => void;

interface MaskBrushInputs {
  readonly painting: ViewportMaskPainting | null;
  readonly rendererRef: MutableRefObject<ViewportRenderer | null>;
}

function useViewportMaskBrushAttachment(
  canvasRef: RefObject<HTMLCanvasElement>,
  attachmentRef: MutableRefObject<MaskBrushAttachment | null>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  painting: ViewportMaskPainting | null,
): MaskStrokeSnapshot {
  const [stroke, setStroke] = useState<MaskStrokeSnapshot>(NO_MASK_STROKE);
  const strokeValuesRef = useRef<Uint8Array | null>(null);
  const inputsRef = useLatestValueRef<MaskBrushInputs>({ painting, rendererRef });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const callbacks = buildMaskBrushCallbacks(inputsRef, strokeValuesRef, setStroke);
    const attachment = attachMaskBrushEventHandlers(canvas, callbacks);
    attachmentRef.current = attachment;
    return () => {
      attachmentRef.current = null;
      attachment.detach();
    };
    // canvasRef is stable; latest-value ref holds dynamic inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return stroke;
}

// The hover pixel behind the brush ghost. It tracks pointer moves over the
// canvas while painting is enabled and clears when the pointer leaves or the
// Masks tool closes, so the ghost never lingers.
function useMaskBrushHoverImagePixel(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  painting: ViewportMaskPainting | null,
): MaskImagePoint | null {
  const [hoveredPixel, setHoveredPixel] = useState<MaskImagePoint | null>(null);
  const paintingRef = useLatestValueRef(painting);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachBrushGhostHoverEventHandlers(canvas, {
      isBrushGhostEnabled: () => paintingRef.current !== null,
      onHoverAtCanvasPoint: (point) =>
        setHoveredPixel((previous) =>
          reuseHoveredPixelWhenUnchanged(
            previous,
            convertHoverCanvasPointToImagePixelOrNull(point, rendererRef.current),
          ),
        ),
    });
    // canvasRef and rendererRef are stable refs; latest-value ref holds painting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!painting) setHoveredPixel(null);
  }, [painting]);
  return hoveredPixel;
}

function convertHoverCanvasPointToImagePixelOrNull(
  point: CanvasPixelPoint | null,
  renderer: ViewportRenderer | null,
): MaskImagePoint | null {
  if (!point || !renderer) return null;
  return renderer.getImagePixelAtCanvasPoint(point.x, point.y);
}

// Keeping the previous object while the hovered pixel is unchanged means a
// pointer gliding within one image pixel re-renders nothing.
function reuseHoveredPixelWhenUnchanged(
  previous: MaskImagePoint | null,
  next: MaskImagePoint | null,
): MaskImagePoint | null {
  if (previous && next && previous.x === next.x && previous.y === next.y) return previous;
  return next;
}

function useDiscardInProgressStrokeWhenPaintingStops(
  attachmentRef: MutableRefObject<MaskBrushAttachment | null>,
  painting: ViewportMaskPainting | null,
): void {
  useEffect(() => {
    if (painting) return;
    attachmentRef.current?.cancelInProgressStroke();
  }, [attachmentRef, painting]);
}

function buildMaskBrushCallbacks(
  inputsRef: MutableRefObject<MaskBrushInputs>,
  strokeValuesRef: MutableRefObject<Uint8Array | null>,
  setStroke: MaskStrokeSetter,
): MaskBrushCallbacks {
  return {
    isMaskPaintingEnabled: () => inputsRef.current.painting !== null,
    onStrokeBegin: (point) =>
      beginMaskStrokeAtCanvasPoint(point, inputsRef.current, strokeValuesRef, setStroke),
    onStrokeExtend: (segment) =>
      extendMaskStrokeAlongCanvasSegment(segment, inputsRef.current, strokeValuesRef, setStroke),
    onStrokeCommit: () => commitMaskStroke(inputsRef.current, strokeValuesRef, setStroke),
    onStrokeCancel: () => discardMaskStroke(strokeValuesRef, setStroke),
  };
}

function beginMaskStrokeAtCanvasPoint(
  point: CanvasPixelPoint,
  inputs: MaskBrushInputs,
  strokeValuesRef: MutableRefObject<Uint8Array | null>,
  setStroke: MaskStrokeSetter,
): void {
  if (!inputs.painting) return;
  strokeValuesRef.current = new Uint8Array(inputs.painting.layer.values);
  extendMaskStrokeAlongCanvasSegment({ from: point, to: point }, inputs, strokeValuesRef, setStroke);
}

function extendMaskStrokeAlongCanvasSegment(
  segment: MaskBrushCanvasSegment,
  inputs: MaskBrushInputs,
  strokeValuesRef: MutableRefObject<Uint8Array | null>,
  setStroke: MaskStrokeSetter,
): void {
  const values = strokeValuesRef.current;
  const imageSegment = convertCanvasSegmentToImageSegmentOrNull(segment, inputs.rendererRef.current);
  if (!values || !inputs.painting || !imageSegment) return;
  paintBrushSegmentIntoStrokeValues(values, imageSegment, inputs.painting);
  setStroke((previous) => ({ values, paintVersion: previous.paintVersion + 1 }));
}

// A sample that falls outside the image (the letterbox around a fitted stack)
// has no image pixel; a stroke that starts there simply begins where it first
// crosses back onto the image.
function convertCanvasSegmentToImageSegmentOrNull(
  segment: MaskBrushCanvasSegment,
  renderer: ViewportRenderer | null,
): MaskBrushSegment | null {
  if (!renderer) return null;
  const to = renderer.getImagePixelAtCanvasPoint(segment.to.x, segment.to.y);
  if (!to) return null;
  const from = renderer.getImagePixelAtCanvasPoint(segment.from.x, segment.from.y);
  return { from: from ?? to, to };
}

function paintBrushSegmentIntoStrokeValues(
  values: Uint8Array,
  segment: MaskBrushSegment,
  painting: ViewportMaskPainting,
): void {
  const { layer, brush } = painting;
  const grid = { width: layer.width, height: layer.height };
  const pixelIndexes = listPixelIndexesUnderBrushSegment(segment, brush.brushSizePx, grid);
  const value = resolveMaskBrushPaintValue(brush, layer.categories.length);
  writeMaskValueAtPixelIndexes(values, pixelIndexes, value);
}

function commitMaskStroke(
  inputs: MaskBrushInputs,
  strokeValuesRef: MutableRefObject<Uint8Array | null>,
  setStroke: MaskStrokeSetter,
): void {
  const values = strokeValuesRef.current;
  if (values && inputs.painting) inputs.painting.onCommitStrokeValues(values);
  discardMaskStroke(strokeValuesRef, setStroke);
}

function discardMaskStroke(
  strokeValuesRef: MutableRefObject<Uint8Array | null>,
  setStroke: MaskStrokeSetter,
): void {
  strokeValuesRef.current = null;
  setStroke((previous) => ({ values: null, paintVersion: previous.paintVersion + 1 }));
}
