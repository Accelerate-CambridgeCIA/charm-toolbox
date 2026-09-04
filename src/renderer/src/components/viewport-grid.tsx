import { useCallback, type MouseEvent } from "react";
import { notifyError } from "@/lib/notifications/notify";

import { ViewportBusyOverlay } from "@/components/busy-indicators";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Viewport,
  type ViewportMaskOverlaySelection,
  type ViewportMaskPainting,
} from "@/components/viewport";
import {
  getGridLayoutCellCount,
  getGridLayoutTailwindTrackClasses,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import {
  collectPanelIndicesToLinkFromSelection,
  extractClickModifiers,
} from "@/lib/grid/viewport-selection-click";
import {
  computePixelSpectrumOrNull,
  computeRoiMeanSpectrumOrNull,
} from "@/lib/image/compute-spectrum";
import {
  appendPinnedSpectrumWithCapLimit,
  appendRoiSpectrumKeepingLastTwo,
  buildPinnedSpectrumIdFromTimestamp,
  type PinnedRoiMeanSpectrum,
  type PinnedSpectrum,
} from "@/lib/image/spectrum-entry";
import {
  reduceInspectionRoiSelection,
  resolveInspectionRoiAfterPlainClick,
  type ClickedImagePixel,
} from "@/lib/image/roi-selection-lifecycle";
import type { ViewportRoi } from "@/lib/image/viewport-roi";
import { doesMaskLayerCoverDimensions, type MaskLayer } from "@/lib/masks/mask-layer";
import {
  findSelectedMaskLayerOrNull,
  panelHasMaskLayers,
  replaceSelectedMaskLayerValues,
  toggleMaskOverlayVisibility,
} from "@/lib/masks/mask-panel";
import type { MaskBrushSettings } from "@/lib/masks/mask-brush";
import { cn } from "@/lib/utils";
import { getImageSourceDimensions, type ViewportImageSource } from "@/lib/webgl/texture";
import { useViewportClosing } from "@/state/closing-context";
import { useViewportDuplication } from "@/state/duplication-context";
import { useFalseColorPreview } from "@/state/false-color-preview-context";
import { useToneCurvePreview } from "@/state/tone-curve-preview-context";
import type { ToneCurveChannelPreviewLuts } from "@/lib/image/tone-curve-composite-preview";
import {
  useRegionEditPreviewPublisher,
  type RegionEditTarget,
} from "@/state/region-edit-preview-context";
import { useRegionRequest } from "@/state/region-request-context";
import { useRegionTool } from "@/state/region-tool-context";
import { useMasksTool } from "@/state/masks-tool-context";
import { useViewportBandRemoval } from "@/state/band-removal-context";
import { useViewportReimport } from "@/state/reimport-context";
import { useViewportRendering } from "@/state/viewport-rendering-context";
import { useViewportSelection } from "@/state/selection-context";
import { usePanelLink, type PanelLinkApi, type PanelLinkFailureReason } from "@/state/panel-link-context";

export interface ViewportCellContent {
  fileName: string;
  source: ViewportImageSource;
  originalFilePath?: string;
  fileSizeBytes?: number;
}

interface ViewportGridProps {
  layout: GridLayout;
  cellsByIndex: ReadonlyMap<number, ViewportCellContent>;
  onOpenImage: () => void;
}

export function ViewportGrid(props: ViewportGridProps): JSX.Element {
  const cellCount = getGridLayoutCellCount(props.layout);
  const trackClasses = getGridLayoutTailwindTrackClasses(props.layout);
  return (
    <div
      role="grid"
      aria-label="Panel grid"
      className={cn("grid h-full w-full gap-2", trackClasses)}
    >
      {renderViewportCells(cellCount, props)}
    </div>
  );
}

function renderViewportCells(
  cellCount: number,
  props: ViewportGridProps,
): ReadonlyArray<JSX.Element> {
  return Array.from({ length: cellCount }, (_, cellIndex) => (
    <ViewportCell
      key={cellIndex}
      cellIndex={cellIndex}
      viewportNumber={getViewportNumberFromIndex(cellIndex)}
      content={props.cellsByIndex.get(cellIndex) ?? null}
      onOpenImage={props.onOpenImage}
    />
  ));
}

interface ViewportCellProps {
  cellIndex: number;
  viewportNumber: number;
  content: ViewportCellContent | null;
  onOpenImage: () => void;
}

function ViewportCell(props: ViewportCellProps): JSX.Element {
  const settings = useViewportCellInteractionSettings(props.cellIndex, props.content);
  const cellElement = renderViewportCellGridcellElement(props, settings);
  if (!props.content) return cellElement;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{cellElement}</ContextMenuTrigger>
      <ViewportCellContextMenuContent sourceIndex={props.cellIndex} />
    </ContextMenu>
  );
}

function renderViewportCellGridcellElement(
  props: ViewportCellProps,
  settings: ViewportCellInteractionSettings,
): JSX.Element {
  return (
    <div
      role="gridcell"
      aria-selected={settings.isSelected}
      onClick={settings.handleClick}
      onContextMenu={settings.handleContextMenuClick}
      className={getViewportCellClassName(settings.isSelected)}
    >
      {renderViewportCellViewport(props, settings)}
      <ViewportBusyOverlay viewportIndex={props.cellIndex} />
    </div>
  );
}

function renderViewportCellViewport(
  props: ViewportCellProps,
  settings: ViewportCellInteractionSettings,
): JSX.Element {
  return (
    <Viewport
      viewportNumber={props.viewportNumber}
      imageSource={props.content?.source ?? null}
      previewImageSource={settings.previewImageSource}
      toneCurvePreviewLookupTable={settings.toneCurvePreviewLookupTable}
      toneCurvePreviewChannelLookupTables={settings.toneCurvePreviewChannelLookupTables}
      fileName={props.content?.fileName ?? null}
      normalizationEnabled={settings.normalizationEnabled}
      onToggleNormalizedViewing={settings.handleToggleNormalizedViewing}
      showMaskOverlayToggle={settings.showMaskOverlayToggle}
      maskOverlayVisible={settings.maskOverlayVisible}
      onToggleMaskOverlayVisibility={settings.handleToggleMaskOverlayVisibility}
      viewChannelsSeparately={settings.viewChannelsSeparately}
      onToggleViewChannelsSeparately={settings.handleToggleViewChannelsSeparately}
      selectedBandIndex={settings.selectedBandIndex}
      onSelectBandIndex={settings.handleSelectBandIndex}
      onRemoveBand={settings.handleRemoveBand}
      lastAppliedOperationLabel={settings.lastAppliedOperationLabel}
      isRegionToolActive={settings.isRegionToolActive}
      roi={settings.roi}
      onCommitRoi={settings.handleCommitRoi}
      canEditCommittedRoi={settings.canEditCommittedRoi}
      onPreviewRoiEdit={settings.handlePreviewRoiEdit}
      onCommitRoiEdit={settings.handleCommitRoiEdit}
      onRegionToolPlainClick={settings.handleRegionToolPlainClick}
      maskOverlay={settings.maskOverlay}
      maskPainting={settings.maskPainting}
      onPinPixelSpectrum={settings.handlePinPixelSpectrum}
      onOpenImage={props.onOpenImage}
      onClose={settings.handleClose}
    />
  );
}

function ViewportCellContextMenuContent(props: { sourceIndex: number }): JSX.Element {
  return (
    <ContextMenuContent>
      <DuplicateContextMenuItem sourceIndex={props.sourceIndex} />
      <ReimportSourceContextMenuItem sourceIndex={props.sourceIndex} />
      <LinkPanZoomContextMenuItem sourceIndex={props.sourceIndex} />
      <CloseContextMenuItem sourceIndex={props.sourceIndex} />
    </ContextMenuContent>
  );
}

interface ViewportCellInteractionSettings {
  isSelected: boolean;
  handleClick: (event: MouseEvent<HTMLDivElement>) => void;
  handleContextMenuClick: () => void;
  handleClose: (() => void) | undefined;
  previewImageSource: ViewportImageSource | null;
  toneCurvePreviewLookupTable: ReadonlyArray<number> | null;
  toneCurvePreviewChannelLookupTables: ToneCurveChannelPreviewLuts | null;
  normalizationEnabled: boolean;
  handleToggleNormalizedViewing: () => void;
  showMaskOverlayToggle: boolean;
  maskOverlayVisible: boolean;
  handleToggleMaskOverlayVisibility: () => void;
  viewChannelsSeparately: boolean;
  handleToggleViewChannelsSeparately: () => void;
  selectedBandIndex: number;
  handleSelectBandIndex: (bandIndex: number) => void;
  handleRemoveBand: (bandIndex: number) => void;
  lastAppliedOperationLabel: string | null;
  isRegionToolActive: boolean;
  roi: ViewportRoi | null;
  handleCommitRoi: (roi: ViewportRoi) => void;
  canEditCommittedRoi: boolean;
  handlePreviewRoiEdit: (roi: ViewportRoi | null) => void;
  handleCommitRoiEdit: (roi: ViewportRoi) => void;
  handleRegionToolPlainClick: (clickedImagePixel: ClickedImagePixel | null) => void;
  handlePinPixelSpectrum: (imageX: number, imageY: number) => void;
  maskOverlay: ViewportMaskOverlaySelection | null;
  maskPainting: ViewportMaskPainting | null;
}

function useViewportCellInteractionSettings(
  cellIndex: number,
  content: ViewportCellContent | null,
): ViewportCellInteractionSettings {
  const { isViewportSelected, selectViewportFromClick, selectViewportFromContextMenuClick } =
    useViewportSelection();
  const { getRenderingState, setRenderingState } = useViewportRendering();
  const { isRegionToolActive } = useRegionTool();
  const masksTool = useMasksTool();
  const regionRequest = useRegionRequest();
  const { getPreviewSourceForViewport } = useFalseColorPreview();
  const { getLookupTableForViewport, getChannelLookupTablesForViewport } = useToneCurvePreview();
  const { removeBand } = useViewportBandRemoval();
  const closing = useViewportClosing();
  const isSelected = isViewportSelected(cellIndex);
  const renderingState = getRenderingState(cellIndex);
  const isOperationRegionRequestActive = regionRequest.isRegionRequestActiveForViewport(cellIndex);
  const handleClick = (event: MouseEvent<HTMLDivElement>) =>
    selectViewportFromClick(cellIndex, extractClickModifiers(event));
  const handleContextMenuClick = (): void => selectViewportFromContextMenuClick(cellIndex);
  const handleClose = closing.canClose(cellIndex)
    ? () => closing.closeViewport(cellIndex)
    : undefined;
  const handleCommitInspectionRoi = useCallback(
    (roi: ViewportRoi) => {
      const committedRoi = reduceInspectionRoiSelection(renderingState.roi, { kind: "commit", roi });
      const roiSpectrum = committedRoi
        ? buildPinnedRoiSpectrumFromRegion(content, committedRoi)
        : null;
      setRenderingState(cellIndex, {
        ...renderingState,
        roi: committedRoi,
        pinnedRoiSpectra: roiSpectrum
          ? appendRoiSpectrumKeepingLastTwo(renderingState.pinnedRoiSpectra, roiSpectrum)
          : renderingState.pinnedRoiSpectra,
      });
      selectViewportFromClick(cellIndex, { ctrlOrMeta: false, shift: false });
    },
    [cellIndex, content, renderingState, setRenderingState, selectViewportFromClick],
  );
  const handleRegionToolPlainClick = useCallback(
    (clickedImagePixel: ClickedImagePixel | null) => {
      if (isOperationRegionRequestActive) return;
      const nextRoi = resolveInspectionRoiAfterPlainClick(renderingState.roi, clickedImagePixel);
      if (nextRoi === renderingState.roi) return;
      setRenderingState(cellIndex, { ...renderingState, roi: nextRoi });
    },
    [cellIndex, isOperationRegionRequestActive, renderingState, setRenderingState],
  );
  const handleCommitOperationRegion = useCallback(
    (region: ViewportRoi) => {
      setRenderingState(cellIndex, { ...renderingState, operationRegion: region });
      regionRequest.endRegionRequest();
    },
    [cellIndex, renderingState, setRenderingState, regionRequest],
  );
  const handleCommitRoi = isOperationRegionRequestActive
    ? handleCommitOperationRegion
    : handleCommitInspectionRoi;
  // CT-275: edits target whichever committed box is displayed (operationRegion
  // wins, matching the `operationRegion ?? roi` display rule below). Moving or
  // resizing the operation region only rewrites the region; moving the
  // inspection ROI re-commits through the same path as a fresh draw so the
  // pinned ROI mean spectrum tracks the box. While an explicit "Select region"
  // request is active the user is redrawing, so body drags must not move the
  // stale box out from under the new draw.
  const editedRoiTarget: RegionEditTarget = renderingState.operationRegion
    ? "operation-region"
    : "inspection-roi";
  const publishRegionEditPreview = useRegionEditPreviewPublisher();
  const viewportNumber = getViewportNumberFromIndex(cellIndex);
  const handlePreviewRoiEdit = useCallback(
    (roi: ViewportRoi | null) =>
      publishRegionEditPreview(roi ? { viewportNumber, target: editedRoiTarget, roi } : null),
    [publishRegionEditPreview, viewportNumber, editedRoiTarget],
  );
  const handleCommitRoiEdit = useCallback(
    (roi: ViewportRoi) => {
      if (renderingState.operationRegion) {
        setRenderingState(cellIndex, { ...renderingState, operationRegion: roi });
        return;
      }
      handleCommitInspectionRoi(roi);
    },
    [cellIndex, renderingState, setRenderingState, handleCommitInspectionRoi],
  );
  const handlePinPixelSpectrum = useCallback(
    (imageX: number, imageY: number) => {
      const next = buildPinnedPixelSpectrumFromImagePoint(content, imageX, imageY);
      if (!next) return;
      setRenderingState(cellIndex, {
        ...renderingState,
        pinnedSpectra: appendPinnedSpectrumWithCapLimit(renderingState.pinnedSpectra, next),
      });
      selectViewportFromClick(cellIndex, { ctrlOrMeta: false, shift: false });
    },
    [cellIndex, content, renderingState, setRenderingState, selectViewportFromClick],
  );
  const handleToggleNormalizedViewing = useCallback(
    () =>
      setRenderingState(cellIndex, {
        ...renderingState,
        normalizationEnabled: !renderingState.normalizationEnabled,
      }),
    [cellIndex, renderingState, setRenderingState],
  );
  // CT-248: display-only channel view for a colour photo. Both directions land
  // on band 0 so entering starts at Red and leaving restores the composite's
  // untouched readout state exactly as it was before the toggle.
  const handleToggleViewChannelsSeparately = useCallback(
    () =>
      setRenderingState(cellIndex, {
        ...renderingState,
        viewChannelsSeparately: !renderingState.viewChannelsSeparately,
        selectedBandIndex: 0,
      }),
    [cellIndex, renderingState, setRenderingState],
  );
  const handleSelectBandIndex = useCallback(
    (bandIndex: number) =>
      setRenderingState(cellIndex, { ...renderingState, selectedBandIndex: bandIndex }),
    [cellIndex, renderingState, setRenderingState],
  );
  const handleRemoveBand = useCallback(
    (bandIndex: number) => removeBand(cellIndex, bandIndex),
    [cellIndex, removeBand],
  );
  const handleToggleMaskOverlayVisibility = useCallback(
    () =>
      setRenderingState(cellIndex, {
        ...renderingState,
        masks: toggleMaskOverlayVisibility(renderingState.masks),
      }),
    [cellIndex, renderingState, setRenderingState],
  );
  const handleCommitMaskStrokeValues = useCallback(
    (values: Uint8Array) =>
      setRenderingState(cellIndex, {
        ...renderingState,
        masks: replaceSelectedMaskLayerValues(renderingState.masks, values),
      }),
    [cellIndex, renderingState, setRenderingState],
  );
  return {
    isSelected,
    handleClick,
    handleContextMenuClick,
    handleClose,
    previewImageSource: getPreviewSourceForViewport(cellIndex),
    toneCurvePreviewLookupTable: getLookupTableForViewport(cellIndex),
    toneCurvePreviewChannelLookupTables: getChannelLookupTablesForViewport(cellIndex),
    normalizationEnabled: renderingState.normalizationEnabled,
    handleToggleNormalizedViewing,
    showMaskOverlayToggle: panelHasMaskLayers(renderingState.masks),
    maskOverlayVisible: renderingState.masks.isOverlayVisible,
    handleToggleMaskOverlayVisibility,
    viewChannelsSeparately: renderingState.viewChannelsSeparately,
    handleToggleViewChannelsSeparately,
    selectedBandIndex: renderingState.selectedBandIndex,
    handleSelectBandIndex,
    handleRemoveBand,
    lastAppliedOperationLabel: renderingState.lastAppliedOperationLabel,
    isRegionToolActive: isRegionToolActive || isOperationRegionRequestActive,
    roi: renderingState.operationRegion ?? renderingState.roi,
    handleCommitRoi,
    canEditCommittedRoi: !isOperationRegionRequestActive,
    handlePreviewRoiEdit,
    handleCommitRoiEdit,
    handleRegionToolPlainClick,
    handlePinPixelSpectrum,
    maskOverlay: buildMaskOverlayOrNull({
      isOverlayVisible: renderingState.masks.isOverlayVisible,
      layer: findSelectedMaskLayerOrNull(renderingState.masks),
      content,
    }),
    maskPainting: buildMaskPaintingOrNull({
      isSelected,
      isMasksToolActive: masksTool.isMasksToolActive,
      layer: findSelectedMaskLayerOrNull(renderingState.masks),
      brush: masksTool.brush,
      content,
      onCommitStrokeValues: handleCommitMaskStrokeValues,
    }),
  };
}

// CT-342: the overlay is drawn whenever the panel's own visibility flag is on,
// a layer is selected, and that layer still covers the panel's stack. Neither
// the panel's selection nor the Masks tool takes part: a mask a user chose to
// see stays on screen while they work in another panel or another tool.
export interface MaskOverlayInputs {
  readonly isOverlayVisible: boolean;
  readonly layer: MaskLayer | null;
  readonly content: ViewportCellContent | null;
}

export function buildMaskOverlayOrNull(
  inputs: MaskOverlayInputs,
): ViewportMaskOverlaySelection | null {
  if (!inputs.isOverlayVisible) return null;
  const layer = findMaskLayerCoveringPanelContentOrNull(inputs.layer, inputs.content);
  return layer ? { layer } : null;
}

function findMaskLayerCoveringPanelContentOrNull(
  layer: MaskLayer | null,
  content: ViewportCellContent | null,
): MaskLayer | null {
  if (!layer || !content) return null;
  const dimensions = getImageSourceDimensions(content.source);
  if (!doesMaskLayerCoverDimensions(layer, dimensions.width, dimensions.height)) return null;
  return layer;
}

// CT-304: painting exists only while the Masks tool is on, a layer is selected,
// and that layer still covers the panel's stack. CT-331: it also requires the
// panel to be SELECTED, so opening the Masks tool does not paint into every
// panel that carries a layer.
export interface MaskPaintingInputs {
  readonly isSelected: boolean;
  readonly isMasksToolActive: boolean;
  readonly layer: MaskLayer | null;
  readonly brush: MaskBrushSettings;
  readonly content: ViewportCellContent | null;
  readonly onCommitStrokeValues: (values: Uint8Array) => void;
}

export function buildMaskPaintingOrNull(inputs: MaskPaintingInputs): ViewportMaskPainting | null {
  if (!inputs.isSelected || !inputs.isMasksToolActive) return null;
  const layer = findMaskLayerCoveringPanelContentOrNull(inputs.layer, inputs.content);
  if (!layer) return null;
  return {
    layer,
    brush: inputs.brush,
    onCommitStrokeValues: inputs.onCommitStrokeValues,
  };
}

function buildPinnedPixelSpectrumFromImagePoint(
  content: ViewportCellContent | null,
  imageX: number,
  imageY: number,
): PinnedSpectrum | null {
  if (!content || content.source.kind !== "raster") return null;
  const spectrum = computePixelSpectrumOrNull(content.source.raster, imageX, imageY);
  if (!spectrum) return null;
  return {
    kind: "pixel",
    id: buildPinnedSpectrumIdFromTimestamp(Date.now(), Math.random()),
    imagePixelX: imageX,
    imagePixelY: imageY,
    bandValues: spectrum.bandValues,
  };
}

function buildPinnedRoiSpectrumFromRegion(
  content: ViewportCellContent | null,
  roi: ViewportRoi,
): PinnedRoiMeanSpectrum | null {
  if (!content || content.source.kind !== "raster") return null;
  const spectrum = computeRoiMeanSpectrumOrNull(content.source.raster, roi);
  if (!spectrum) return null;
  return {
    kind: "roi-mean",
    id: buildPinnedSpectrumIdFromTimestamp(Date.now(), Math.random()),
    samplePixelCount: spectrum.samplePixelCount,
    bandMeans: spectrum.bandMeans,
    bandStandardDeviations: spectrum.bandStandardDeviations,
  };
}

function getViewportCellClassName(isSelected: boolean): string {
  return cn(
    "relative min-h-0 min-w-0 rounded-md transition-shadow",
    isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
  );
}

function DuplicateContextMenuItem(props: { sourceIndex: number }): JSX.Element {
  const duplication = useViewportDuplication();
  return (
    <ContextMenuItem onSelect={() => duplication.requestDuplicate(props.sourceIndex)}>
      Duplicate
    </ContextMenuItem>
  );
}

function CloseContextMenuItem(props: { sourceIndex: number }): JSX.Element {
  const closing = useViewportClosing();
  return (
    <ContextMenuItem onSelect={() => closing.closeViewport(props.sourceIndex)}>
      Close
    </ContextMenuItem>
  );
}

function ReimportSourceContextMenuItem(props: { sourceIndex: number }): JSX.Element {
  const reimport = useViewportReimport();
  return (
    <ContextMenuItem onSelect={() => reimport.requestReimport(props.sourceIndex)}>
      Re-import source from disk
    </ContextMenuItem>
  );
}

const LINK_PAN_ZOOM_MULTI_SELECT_HINT =
  "Cmd-click (Mac) or Ctrl-click panels to select more, then link";

function LinkPanZoomContextMenuItem(props: { sourceIndex: number }): JSX.Element {
  const panelLink = usePanelLink();
  const { selectedIndices } = useViewportSelection();
  if (panelLink.isPanelLinked(props.sourceIndex)) {
    return (
      <ContextMenuItem onSelect={() => panelLink.unlinkPanel(props.sourceIndex)}>
        Unlink pan &amp; zoom
      </ContextMenuItem>
    );
  }
  const indicesToLink = collectPanelIndicesToLinkFromSelection(selectedIndices, props.sourceIndex);
  if (indicesToLink.length < 2) return <LinkPanZoomDisabledHintMenuItem />;
  return (
    <ContextMenuItem onSelect={() => linkPanZoomAcrossPanels(panelLink, indicesToLink)}>
      Link pan &amp; zoom
    </ContextMenuItem>
  );
}

function LinkPanZoomDisabledHintMenuItem(): JSX.Element {
  return (
    <ContextMenuItem disabled>
      <div className="flex flex-col gap-0.5">
        <span>Link pan &amp; zoom</span>
        <span className="text-xs text-muted-foreground">{LINK_PAN_ZOOM_MULTI_SELECT_HINT}</span>
      </div>
    </ContextMenuItem>
  );
}

function linkPanZoomAcrossPanels(
  panelLink: PanelLinkApi,
  panelIndices: ReadonlyArray<number>,
): void {
  const result = panelLink.linkPanels([...panelIndices]);
  if (!result.ok) notifyError(describePanelLinkFailureMessage(result.reason));
}

function describePanelLinkFailureMessage(reason: PanelLinkFailureReason): string {
  if (reason === "different-size") return "Only panels of the same size can be linked.";
  return "Select two or more panels to link their pan and zoom.";
}
