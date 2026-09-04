import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { AboutDialog } from "@/components/about-dialog";
import { PythonEnvironmentDialog } from "@/components/python-environment-dialog";
import { AppBusyModal } from "@/components/busy-indicators";
import { StatusBar } from "@/components/status-bar";
import {
  OpenImageReplaceTargetPicker,
  type ConfirmedOpenImagesReplacePlan,
  type PendingOpenImageReplaceItem,
  type PendingOpenImagesReplace,
} from "@/components/open-image-replace-target-picker";
import { OpenImagesReviewModal } from "@/components/open-images-review-modal";
import { SaveImageFormatPicker } from "@/components/save-image-format-picker";
import {
  ToolOptionsPanel,
  type ToolOptionsApplyOptions,
  type ToolOptionsSourceViewport,
} from "@/components/tool-options-panel";
import {
  MasksOptionsPanel,
  type MasksOptionsTarget,
} from "@/components/masks-options-panel";
import {
  NpcOptionsPanel,
  type NpcPanelTarget,
} from "@/components/npc-options-panel";
import {
  CnrOptionsPanel,
  type CnrPanelTarget,
} from "@/components/cnr-options-panel";
import {
  RopOptionsPanel,
  type RopPanelTarget,
  type RopRepinOffer,
} from "@/components/rop-options-panel";
import {
  buildRopCandidateDeliveryPort,
  type RopCandidateDeliveryPort,
} from "@/lib/analysis/rop-candidate-delivery";
import { keepRopCandidateAsNewStack } from "@/lib/analysis/rop-keep-flow";
import {
  hasPinnedRopPanelLostItsRaster,
  repinRopToSelection,
  resolveNextRopPin,
  type RopPinnedPanel,
  type RopPinSelection,
} from "@/lib/analysis/rop-pinned-target";
import type { RopKeepRequest } from "@/lib/actions/rop-keep-action";
import { ToolOptionsThresholdEditor } from "@/components/tool-options-threshold-editor";
import { ToolOptionsBandWeightingEditor } from "@/components/tool-options-band-weighting-editor";
import { ToolOptionsCustomTransformEditor } from "@/components/tool-options-custom-transform-editor";
import { ToolOptionsToneCurveEditor } from "@/components/tool-options-tone-curve-editor";
import {
  Toolbar,
  type ActionAvailabilityForActiveViewport,
  type BandSubsetToolbarToggleState,
} from "@/components/toolbar";
import {
  ViewportRightPanel,
  type ViewportRightPanelActiveSource,
} from "@/components/viewport-right-panel";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DuplicateReplaceTargetPicker,
  type DuplicateReplaceTargetEntry,
  type PendingDuplicateReplace,
} from "@/components/viewport-duplicate-replace-target-picker";
import { ViewportGrid, type ViewportCellContent } from "@/components/viewport-grid";
import {
  applyActionInPlaceAtSourceIndex,
  applyActionToDuplicateOfSource,
  runDuplicateAndApplyAtTargetIndex,
  type ApplyActionFlowBindings,
} from "@/lib/actions/apply-action-flow";
import {
  createInFlightApplyRunStore,
  type InFlightApplyRunStore,
} from "@/lib/actions/in-flight-apply-run-store";
import { BAND_SELECTION_ACTION } from "@/lib/actions/band-selection-action";
import {
  buildDuplicateBandsParameterValuesFromBandNumbers,
  DUPLICATE_BANDS_ACTION,
} from "@/lib/actions/duplicate-bands-action";
import {
  buildViewportClosingApi,
  type ViewportClosingApiBindings,
} from "@/lib/actions/close-viewport-flow";
import {
  BAND_SUBSET_ACTION,
  GEOMETRIC_TRANSFORM_PARAMETER_ID,
  ROTATE_ACTION,
  buildBandSubsetParameterValuesFromKeptNumbers,
  findGeometricTransformActionForChoice,
  readBrightnessPercent,
  readContrastRatio,
  readFalseColorBandAssignment,
  type RegisteredViewportAction,
} from "@/lib/actions/registered-actions";
import {
  buildToolbarOperationGroups,
  dispatchOperationCommand,
  type OperationCommandHandlers,
} from "@/lib/actions/operation-command-bindings";
import type { GeometricTransform } from "@/lib/image/apply-geometric-transform";
import {
  clearOperationRegionAtViewportIndex,
  clearOperationRegionOnViewportsLeavingSelection,
} from "@/lib/actions/operation-region";
import { shouldEmbedThresholdEditorInOperationPanel } from "@/lib/actions/threshold-editor-placement";
import {
  OTSU_THRESHOLD_METHOD,
  readThresholdMethodChoice,
} from "@/lib/actions/threshold-action";
import { shouldEmbedBandWeightingEditorInOperationPanel } from "@/lib/actions/band-weighting-editor-placement";
import { shouldEmbedCustomTransformEditorInOperationPanel } from "@/lib/actions/custom-transform-editor-placement";
import { shouldEmbedToneCurveEditorInOperationPanel } from "@/lib/actions/tone-curve-editor-placement";
import {
  listKeptBandIndexesFromRemoved,
  listKeptBandOriginalNumbersAfterRemovingBand,
} from "@/lib/image/apply-band-keep";
import type { ViewportDisplayMappingState } from "@/lib/image/as-viewed-display-mapping";
import { buildFalseColorPreviewSourceOrNull } from "@/lib/image/false-color-preview-pixels";
import type { FalseColorBandAssignment } from "@/lib/image/apply-false-color-composite";
import { buildToneCurvePreviewLutOrNull } from "@/lib/image/tone-curve-preview";
import {
  buildBrightnessContrastCompositePreviewLutsOrNull,
  buildBrightnessContrastPreviewLutOrNull,
} from "@/lib/image/brightness-contrast-preview";
import { buildThresholdPreviewLutOrNull } from "@/lib/image/threshold/threshold-preview";
import {
  buildComposedChannelPreviewLutOrNull,
  isCompositeToneCurvePreviewActive,
  type ColorToneCurveChannel,
} from "@/lib/image/tone-curve-composite-preview";
import {
  DEFAULT_TONE_CURVE_CHANNEL,
  mergeActiveToneCurveChannelAnchors,
  type ToneCurveChannelAnchors,
} from "@/lib/image/tone-curve-channels";
import type { ToneCurveChannelPreviewLuts } from "@/lib/image/tone-curve-composite-preview";
import { recordPreviewRasterAllocation } from "@/lib/instrumentation/render-instrumentation";
import {
  getRasterBandOriginalNumber,
  type RasterImage,
} from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import {
  listRememberedReferenceRasters,
  replaceRememberedPanelReferenceRasters,
} from "@/lib/image/reference-raster-store";
import {
  readRasterBufferReleaseWorkVersion,
  releaseQueuedRasterBuffersSkippingShared,
  subscribeToRasterBufferReleaseWork,
} from "@/lib/image/raster-buffer-release";
import {
  buildLoadedReferenceCandidates,
  type LoadedPanelReferenceEntry,
  type LoadedReferenceCandidate,
} from "@/lib/image/reference-token";
import { isSelectableGridLayout } from "@shared/grid-layouts";
import {
  getGridLayoutCellCount,
  getNextLargerGridLayout,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { planOpenImagePlacement } from "@/lib/grid/plan-open-image";
import {
  planOpenImagesPlacement,
  type OpenImagesPlacementPlan,
} from "@/lib/grid/plan-open-images";
import { notifyError, notifySuccess } from "@/lib/notifications/notify";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import {
  DUPLICATE_MEMORY_REFUSAL_MESSAGE,
  rasterAllocationExceedsMemoryBudget,
  remainingRasterMemoryBudgetBytes,
  sumLiveRasterBytesAcrossSources,
} from "@/lib/image/raster-memory-budget";
import { estimateSourceCloneBytes } from "@/lib/actions/estimate-apply-allocation";
import {
  readAndDecodeSingleOpenedImageFile,
  readAndDecodeSingleOpenedImageFileOrThrow,
  runOpenImagesDialogPhase,
} from "@/lib/image/run-open-images-flow";
import { buildConfirmedStackFromOrderedEntriesWithProgress } from "@/lib/image/confirm-stack-build";
import { replaceViewportContentResettingPanelState } from "@/lib/image/replace-viewport-content";
import type { DecodedStackEntry } from "@/lib/image/open-image-stack-types";
import type {
  GroupedOpenedFileRow,
  OpenedFileForGrouping,
  OpenedFilesGroup,
  OpenedFilesGroupingProposal,
} from "@/lib/image/group-opened-files";
import { buildViewportImageMetadataDisplay } from "@/lib/image/image-metadata-display";
import { computeRoiMeanSpectrumOrNull } from "@/lib/image/compute-spectrum";
import {
  removePinnedSpectrumById,
  removeRoiSpectrumById,
} from "@/lib/image/spectrum-entry";
import {
  buildSaveImageFailureToastText,
  runSaveImageFlowThroughMainProcess,
} from "@/lib/image/run-save-image-flow";
import type { SaveImageFormatId } from "@/lib/image/save-image-formats";
import {
  findLowestIndexEmptyViewport,
  listOccupiedViewportEntries,
} from "@/lib/image/find-empty-viewport";
import { placeClonedSourceContentAtIndex } from "@/lib/image/place-cloned-source-content";
import { SaveBeforeCloseDialog } from "@/components/save-before-close-dialog";
import {
  useProjectContentRevisionTracker,
  type ProjectContentRevisionTracker,
} from "@/lib/project/use-project-content-revisions";
import { useWindowCloseGuard } from "@/lib/project/use-window-close-guard";
import {
  runOpenProjectFlowThroughMainProcess,
  type OpenedProject,
  type OpenedProjectViewportSnapshot,
} from "@/lib/project/run-open-project-flow";
import { runSaveProjectBundleFlowThroughMainProcess } from "@/lib/project/run-save-bundle-flow";
import {
  saveableSnapshotRequiresRasterRebake,
  type SaveableProjectSnapshot,
} from "@/lib/project/serialize-project";
import { applyDarkClassToDocumentRoot } from "@/lib/theme/apply-theme-class";
import { useCurrentThemeSnapshot } from "@/lib/theme/use-current-theme-snapshot";
import {
  ViewportClosingProvider,
  type ViewportClosingApi,
} from "@/state/closing-context";
import {
  ViewportDuplicationProvider,
  type ViewportDuplicationApi,
} from "@/state/duplication-context";
import {
  BusyStateProvider,
  useBusyEntryRegistrar,
  waitForBusyIndicatorToClearAntiFlashThreshold,
  type BusyEntryHandle,
  type BusyEntryRegistrar,
} from "@/state/busy-state-context";
import { PixelReadoutProvider } from "@/state/pixel-readout-context";
import { RegionEditPreviewProvider } from "@/state/region-edit-preview-context";
import { RightPanelCollapsedStateProvider } from "@/state/right-panel-collapsed-state";
import {
  RegionToolProvider,
  useRegionTool,
} from "@/state/region-tool-context";
import { MasksToolProvider, useMasksTool, type MasksToolApi } from "@/state/masks-tool-context";
import {
  RegionRequestProvider,
  useRegionRequest,
  type RegionRequestApi,
} from "@/state/region-request-context";
import {
  FalseColorPreviewProvider,
  useFalseColorPreview,
  type FalseColorPreview,
  type FalseColorPreviewApi,
} from "@/state/false-color-preview-context";
import {
  ToneCurvePreviewProvider,
  useToneCurvePreview,
  type ToneCurveLutPreview,
  type ToneCurvePreviewApi,
} from "@/state/tone-curve-preview-context";
import {
  ViewportReimportProvider,
  type ViewportReimportApi,
} from "@/state/reimport-context";
import {
  ViewportBandRemovalProvider,
  type ViewportBandRemovalApi,
} from "@/state/band-removal-context";
import {
  ViewportSelectionProvider,
  useViewportSelection,
  type ViewportSelectionState,
} from "@/state/selection-context";
import { PanelLinkProvider, usePanelLink } from "@/state/panel-link-context";
import {
  ViewportRenderingProvider,
  useViewportRendering,
  type ViewportRenderingApi,
  type ViewportRenderingByIndex,
} from "@/state/viewport-rendering-context";
import {
  clearBandSelectionEditingState,
  closeBandSubsetEditorAndClearFunctionChoice,
  clearBandWeightingEditingState,
  clearCubeTransformEditingState,
  clearThresholdEditingState,
  clearToneCurveEditingState,
  DEFAULT_VIEWPORT_RENDERING_STATE,
  EMPTY_TONE_CURVE_CHANNEL_ANCHORS,
  hasBandSelectionEditingState,
  hasBandWeightingEditingState,
  hasCubeTransformEditingState,
  hasThresholdEditingState,
  hasToneCurveEditingState,
  type ApplyScope,
  type ViewportRenderingState,
} from "@/lib/actions/viewport-action";
import { NO_PARAMETER_VALUES, type ParameterValuesById } from "@/lib/actions/parameter-schema";
import { appendOperationHistoryEntry } from "@/lib/actions/operation-history";
import { showMaskOverlayWhenOpeningMasksTool, type MaskPanelState } from "@/lib/masks/mask-panel";
import type { MaskBrushSettings } from "@/lib/masks/mask-brush";
import { getImageSourceDimensions } from "@/lib/webgl/texture";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;
type SetImagesByIndex = Dispatch<SetStateAction<ImagesByIndexMap>>;
type SetGridLayout = Dispatch<SetStateAction<GridLayout>>;
type SetPendingDuplicate = Dispatch<SetStateAction<PendingDuplicateReplace | null>>;
type SetActiveAction = Dispatch<SetStateAction<RegisteredViewportAction | null>>;
type SetPendingOpenImagesReplace = Dispatch<SetStateAction<PendingOpenImagesReplace | null>>;
type SetPendingOpenImagesReview = Dispatch<SetStateAction<OpenedFilesGroupingProposal | null>>;
type SetPendingSaveImage = Dispatch<SetStateAction<PendingSaveImageRequest | null>>;
type SelectViewportFromClick = ViewportSelectionState["selectViewportFromClick"];
type SetCurrentProjectFilePath = Dispatch<SetStateAction<string | null>>;

interface SingleSelectedSource {
  readonly index: number;
  readonly summary: ToolOptionsSourceViewport;
}

interface PendingSaveImageRequest {
  readonly fileName: string;
  readonly viewportIndex: number;
  readonly isTrueColorPhoto: boolean;
  readonly isFloatSource: boolean;
  readonly bandCount: number;
  readonly selectedBandNumber: number;
}

export function App(): JSX.Element {
  useThemeClassSyncedWithMainProcess();
  return (
    <TooltipProvider delayDuration={300}>
      <ViewportSelectionProvider>
        <PanelLinkProvider>
        <ViewportRenderingProvider>
          <RegionToolProvider>
            <MasksToolProvider>
            <RegionRequestProvider>
            <FalseColorPreviewProvider>
              <ToneCurvePreviewProvider>
                <PixelReadoutProvider>
                  <RegionEditPreviewProvider>
                  <BusyStateProvider>
                    <RightPanelCollapsedStateProvider>
                      <ApplicationShell />
                      <AboutDialog />
                      <PythonEnvironmentDialog />
                      <AppBusyModal />
                      <Toaster />
                    </RightPanelCollapsedStateProvider>
                  </BusyStateProvider>
                  </RegionEditPreviewProvider>
                </PixelReadoutProvider>
              </ToneCurvePreviewProvider>
            </FalseColorPreviewProvider>
            </RegionRequestProvider>
            </MasksToolProvider>
          </RegionToolProvider>
        </ViewportRenderingProvider>
        </PanelLinkProvider>
      </ViewportSelectionProvider>
    </TooltipProvider>
  );
}

function useThemeClassSyncedWithMainProcess(): void {
  const snapshot = useCurrentThemeSnapshot();
  useEffect(() => applyDarkClassToDocumentRoot(snapshot.isDark), [snapshot.isDark]);
}

function ApplicationShell(): JSX.Element {
  const busyRegistrar = useBusyEntryRegistrar();
  const inFlightApplyRuns = useInFlightApplyRunStore();
  const [gridLayout, setGridLayout] = useState<GridLayout>(DEFAULT_GRID_LAYOUT);
  const [imagesByIndex, setImagesByIndex] = useState<ImagesByIndexMap>(createEmptyImagesMap);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicateReplace | null>(null);
  const [activeAction, setActiveAction] = useState<RegisteredViewportAction | null>(null);
  const [isNpcPanelOpen, setIsNpcPanelOpen] = useState(false);
  const [isCnrPanelOpen, setIsCnrPanelOpen] = useState(false);
  const [isRopPanelOpen, setIsRopPanelOpen] = useState(false);
  const [pinnedRopPanel, setPinnedRopPanel] = useState<RopPinnedPanel | null>(null);
  const [pendingOpenImagesReplace, setPendingOpenImagesReplace] =
    useState<PendingOpenImagesReplace | null>(null);
  const [pendingOpenImagesReview, setPendingOpenImagesReview] =
    useState<OpenedFilesGroupingProposal | null>(null);
  const [pendingSaveImage, setPendingSaveImage] =
    useState<PendingSaveImageRequest | null>(null);
  const [currentProjectFilePath, setCurrentProjectFilePath] = useState<string | null>(null);
  const {
    selectedIndices,
    pruneSelectionToCellCount,
    selectViewportFromClick,
    compactSelectionAfterRemovingIndex,
    replaceSelection,
  } = useViewportSelection();
  const renderingApi = useViewportRendering();
  const panelLink = usePanelLink();
  const regionTool = useRegionTool();
  const masksTool = useMasksTool();
  const regionRequest = useRegionRequest();
  const falseColorPreview = useFalseColorPreview();
  const toneCurvePreview = useToneCurvePreview();
  const [activeActionParameterValues, setActiveActionParameterValues] =
    useState<ParameterValuesById>(NO_PARAMETER_VALUES);
  const cellCount = getGridLayoutCellCount(gridLayout);
  const imagesByIndexRef = useLatestRef(imagesByIndex);
  const projectRevisionTracker = useProjectContentRevisionTracker(imagesByIndex);
  const handleGridLayoutChange = createGridLayoutChangeHandler({
    currentLayout: gridLayout,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneSelectionToCellCount,
    pruneRenderingStateToCellCount: renderingApi.pruneRenderingStateToCellCount,
    pruneLinkGroupsToCellCount: panelLink.pruneToCellCount,
  });
  useMenuSelectGridLayoutTriggersHandler(handleGridLayoutChange);
  const gridLayoutRef = useLatestRef(gridLayout);
  const handleOpenImagesRequested = useOpenImagesThroughDialogHandler({
    imagesByIndexRef,
    gridLayoutRef,
    setGridLayout,
    setImagesByIndex,
    setRenderingState: renderingApi.setRenderingState,
    setPendingOpenImagesReplace,
    setPendingOpenImagesReview,
    selectViewportFromClick,
    busyRegistrar,
  });
  useMenuOpenImageTriggersHandler(handleOpenImagesRequested);
  const handleSaveImageRequested = useSaveImageRequestHandler({
    imagesByIndexRef,
    selectedIndicesRef: useLatestRef(selectedIndices),
    renderingApi,
    setPendingSaveImage,
  });
  useMenuSaveImageTriggersHandler(handleSaveImageRequested);
  const handleSaveProjectRequested = useSaveProjectRequestHandler({
    gridLayoutRef: useLatestRef(gridLayout),
    imagesByIndexRef,
    selectedIndicesRef: useLatestRef(selectedIndices),
    renderingApi,
    currentProjectFilePathRef: useLatestRef(currentProjectFilePath),
    setCurrentProjectFilePath,
    projectRevisionTracker,
    busyRegistrar,
  });
  useMenuSaveProjectTriggersHandler(handleSaveProjectRequested.saveOrPromptForPath);
  useMenuSaveProjectAsTriggersHandler(handleSaveProjectRequested.alwaysPromptForPath);
  const handleOpenProjectRequested = useOpenProjectRequestHandler({
    setGridLayout,
    setImagesByIndex,
    setCurrentProjectFilePath,
    projectRevisionTracker,
    replaceAllRenderingStates: renderingApi.replaceAllRenderingStates,
    replaceSelection,
    busyRegistrar,
  });
  const windowCloseGuard = useWindowCloseGuard({
    imagesByIndexRef,
    revisionTracker: projectRevisionTracker,
    saveProjectReportingSuccess: handleSaveProjectRequested.saveReportingSuccess,
  });
  useMenuOpenProjectTriggersHandler(handleOpenProjectRequested);
  const applyActionFlowBindings = buildApplyActionFlowBindings({
    gridLayout,
    cellCount,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    setPendingDuplicate,
    renderingApi,
    replaceSelection,
    busyRegistrar,
    inFlightApplyRuns,
  });
  const singleSelectedSource = deriveSingleSelectedSource(selectedIndices, imagesByIndex, renderingApi);
  const ropPin = isRopPanelOpen
    ? resolveNextRopPin(pinnedRopPanel, toRopPinSelectionOrNull(singleSelectedSource), imagesByIndex)
    : null;
  useRopPinRetainedAcrossSelectionChanges(ropPin, pinnedRopPanel, setPinnedRopPanel);
  const ropRepinTarget = deriveRopRepinTargetOrNull(ropPin, singleSelectedSource, imagesByIndex);
  useRopAsideClosedWithItsPinnedPanel({
    isRopPanelOpen,
    pinnedRopPanel,
    imagesByIndex,
    setIsRopPanelOpen,
  });
  const loadedReferenceCandidates = useLoadedReferenceCandidates(imagesByIndex);
  usePublishActiveToolPreview({
    activeAction,
    singleSelectedSource,
    imagesByIndex,
    parameterValues: activeActionParameterValues,
    falseColorPreview,
    toneCurvePreview,
    renderingApi,
  });
  const rightPanelActiveSource = deriveRightPanelActiveSourceFromSelection({
    selectedIndices,
    imagesByIndex,
    renderingApi,
    currentProjectFilePath,
    applyActionFlowBindings,
  });
  useEscapeKeyClearsActiveViewportRoi({
    selectedIndicesRef: useLatestRef(selectedIndices),
    renderingApi,
  });
  useRegionToolDeselectClearsInspectionRoi({
    isRegionToolActive: regionTool.isRegionToolActive,
    cellCount,
    renderingApi,
  });
  useDeselectionClearsOperationRegionOnLeavingPanels({ selectedIndices, renderingApi });
  const regionRequestHandlers = buildToolPanelRegionRequestHandlers({
    activeSourceIndex: singleSelectedSource?.index ?? null,
    regionRequest,
    renderingApi,
    setActiveAction,
  });
  const handleApplyAction = (options: ToolOptionsApplyOptions) => {
    regionRequest.endRegionRequest();
    runApplyActionFromPanel(activeAction, singleSelectedSource, options, applyActionFlowBindings, setActiveAction);
  };
  const operationCommandHandlers = buildOperationCommandHandlers({
    regionTool,
    masksTool: {
      toggleMasksTool: () =>
        toggleMasksToolShowingActivePanelOverlay(
          masksTool,
          singleSelectedSource?.index ?? null,
          renderingApi,
        ),
    },
    bandSubsetToggle: deriveBandSubsetToggleStateForToolbar(singleSelectedSource, imagesByIndex, renderingApi),
    openActionPanel: regionRequestHandlers.openActionPanel,
    openNpcPanel: () =>
      openAnalysisPanelClosingCompetingPanels(regionRequestHandlers, setIsNpcPanelOpen, [
        setIsCnrPanelOpen,
        setIsRopPanelOpen,
      ]),
    openCnrPanel: () =>
      openAnalysisPanelClosingCompetingPanels(regionRequestHandlers, setIsCnrPanelOpen, [
        setIsNpcPanelOpen,
        setIsRopPanelOpen,
      ]),
    openRopPanel: () =>
      openAnalysisPanelClosingCompetingPanels(regionRequestHandlers, setIsRopPanelOpen, [
        setIsNpcPanelOpen,
        setIsCnrPanelOpen,
      ]),
    singleSelectedSource,
    applyActionFlowBindings,
  });
  const operationGroups = buildToolbarOperationGroups({
    handlers: operationCommandHandlers,
    getActionAvailability: (action) =>
      deriveActionAvailabilityForActiveViewport(action, singleSelectedSource, renderingApi),
    regionToolActive: regionTool.isRegionToolActive,
    masksToolActive: masksTool.isMasksToolActive,
    bandSubsetToggle: deriveBandSubsetToggleStateForToolbar(singleSelectedSource, imagesByIndex, renderingApi),
    isQuickTransformAvailable: deriveActionAvailabilityForActiveViewport(
      ROTATE_ACTION,
      singleSelectedSource,
      renderingApi,
    ).isAvailable,
  });
  useMenuInvokeCommandHandler(operationCommandHandlers);
  const duplicationApi = useViewportDuplicationApi({
    gridLayout,
    cellCount,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    setPendingDuplicate,
    getRenderingState: renderingApi.getRenderingState,
    setRenderingState: renderingApi.setRenderingState,
    inFlightApplyRuns,
  });
  const closingApi = useViewportClosingApi({
    gridLayout,
    selectedIndices,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneRenderingStateToCellCount: renderingApi.pruneRenderingStateToCellCount,
    compactRenderingStateAfterRemovingIndex: renderingApi.compactRenderingStateAfterRemovingIndex,
    pruneSelectionToCellCount,
    compactSelectionAfterRemovingIndex,
    pruneLinkGroupsToCellCount: panelLink.pruneToCellCount,
    compactLinkGroupsAfterRemovingIndex: panelLink.compactAfterRemovingIndex,
    replaceSelection,
    inFlightApplyRuns,
  });
  const reimportApi = useViewportReimportApi({
    imagesByIndexRef,
    setImagesByIndex,
    setRenderingState: renderingApi.setRenderingState,
    busyRegistrar,
  });
  const bandRemovalApi = useViewportBandRemovalApi(useLatestRef(applyActionFlowBindings));
  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onOpenImage={handleOpenImagesRequested}
        onOpenProject={handleOpenProjectRequested}
        gridLayout={gridLayout}
        onGridLayoutChange={handleGridLayoutChange}
        operationGroups={operationGroups}
      />
      <ViewportDuplicationProvider value={duplicationApi}>
        <ViewportClosingProvider value={closingApi}>
          <ViewportReimportProvider value={reimportApi}>
            <ViewportBandRemovalProvider value={bandRemovalApi}>
              <ApplicationStageContent
                gridLayout={gridLayout}
                imagesByIndex={imagesByIndex}
                onOpenImage={handleOpenImagesRequested}
                activeAction={activeAction}
                sourceViewport={singleSelectedSource?.summary ?? null}
                loadedReferenceCandidates={loadedReferenceCandidates}
                toolOptionsEmbeddedEditor={buildActiveOperationEmbeddedEditorOrNull(
                  activeAction,
                  singleSelectedSource,
                  imagesByIndex,
                  activeActionParameterValues,
                )}
                isMasksToolActive={masksTool.isMasksToolActive}
                masksTarget={deriveMasksOptionsTargetOrNull(singleSelectedSource, imagesByIndex, renderingApi)}
                onChangeMasks={(next) =>
                  writeMaskPanelStateAtViewport(singleSelectedSource?.index ?? null, next, renderingApi)
                }
                maskBrush={masksTool.brush}
                onChangeMaskBrush={masksTool.setBrush}
                onCloseMasks={() => masksTool.setMasksToolActive(false)}
                isNpcPanelOpen={isNpcPanelOpen}
                npcTarget={deriveNpcPanelTargetOrNull(singleSelectedSource, imagesByIndex, renderingApi)}
                onRecordNpcScore={(appliedLabel) =>
                  appendAnalysisScoreToHistoryAtViewport(
                    singleSelectedSource?.index ?? null,
                    NPC_ANALYSIS_ENTRY,
                    appliedLabel,
                    renderingApi,
                  )
                }
                onCloseNpcPanel={() => setIsNpcPanelOpen(false)}
                isCnrPanelOpen={isCnrPanelOpen}
                cnrTarget={deriveCnrPanelTargetOrNull(singleSelectedSource, imagesByIndex, renderingApi)}
                onRecordCnrScore={(appliedLabel) =>
                  appendAnalysisScoreToHistoryAtViewport(
                    singleSelectedSource?.index ?? null,
                    CNR_ANALYSIS_ENTRY,
                    appliedLabel,
                    renderingApi,
                  )
                }
                onCloseCnrPanel={() => setIsCnrPanelOpen(false)}
                isRopPanelOpen={isRopPanelOpen}
                ropTarget={deriveRopPanelTargetOrNull(ropPin, renderingApi)}
                ropRepinOffer={{
                  selectedPanelNumber: ropRepinTarget?.viewportNumber ?? null,
                  onUseSelectedPanel: () => setPinnedRopPanel(ropRepinTarget),
                }}
                ropCandidateDelivery={buildRopCandidateDeliveryPort(
                  ropPin?.viewportIndex ?? null,
                  applyActionFlowBindings,
                )}
                onKeepRopCandidateAsNewStack={(request) =>
                  keepRopCandidateFromPinnedPanel(request, ropPin, applyActionFlowBindings)
                }
                onCloseRopPanel={() => setIsRopPanelOpen(false)}
                rightPanelActiveSource={rightPanelActiveSource}
                onCancelAction={regionRequestHandlers.closeActionPanel}
                onApplyAction={handleApplyAction}
                onActiveActionParametersChange={setActiveActionParameterValues}
                onBeginRegionRequest={regionRequestHandlers.beginRegionRequest}
                onClearOperationRegion={regionRequestHandlers.clearOperationRegion}
              />
            </ViewportBandRemovalProvider>
          </ViewportReimportProvider>
        </ViewportClosingProvider>
      </ViewportDuplicationProvider>
      <DuplicateReplaceTargetPicker
        pending={pendingDuplicate}
        viewports={buildDuplicateReplaceTargetEntries(pendingDuplicate, imagesByIndex, cellCount)}
        onCancel={() => setPendingDuplicate(null)}
        onConfirm={(targetIndex) =>
          confirmPendingDuplicateReplaceAtTargetIndex(targetIndex, pendingDuplicate, {
            setImagesByIndex,
            setPendingDuplicate,
            applyActionFlowBindings,
          })
        }
      />
      <SaveImageFormatPicker
        pending={pendingSaveImage}
        onCancel={() => setPendingSaveImage(null)}
        onConfirm={(formatId) =>
          confirmSaveImageFormatChoice(formatId, pendingSaveImage, {
            imagesByIndex,
            renderingApi,
            setPendingSaveImage,
            busyRegistrar,
          })
        }
      />
      <OpenImageReplaceTargetPicker
        pending={pendingOpenImagesReplace}
        viewports={listOccupiedViewportEntries(imagesByIndex, cellCount, (content) => content.fileName)}
        onCancel={() => setPendingOpenImagesReplace(null)}
        onConfirm={(plan) =>
          confirmOpenImagesReplaceWithAssignments(plan, pendingOpenImagesReplace, {
            setImagesByIndex,
            setRenderingState: renderingApi.setRenderingState,
            setPendingOpenImagesReplace,
            selectViewportFromClick,
          })
        }
      />
      <OpenImagesReviewModal
        proposal={pendingOpenImagesReview}
        onCancel={() => setPendingOpenImagesReview(null)}
        onConfirm={(groups) =>
          void confirmOpenImagesReviewGroups(groups, {
            imagesByIndexRef,
            gridLayoutRef,
            setGridLayout,
            setImagesByIndex,
            setRenderingState: renderingApi.setRenderingState,
            setPendingOpenImagesReplace,
            setPendingOpenImagesReview,
            selectViewportFromClick,
            busyRegistrar,
          })
        }
      />
      <SaveBeforeCloseDialog
        open={windowCloseGuard.isSaveBeforeCloseDialogOpen}
        onSaveAndClose={windowCloseGuard.saveProjectThenCloseWindow}
        onCloseWithoutSaving={windowCloseGuard.closeWindowWithoutSaving}
        onCancel={windowCloseGuard.cancelCloseRequest}
      />
      <StatusBar />
    </div>
  );
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function createEmptyImagesMap(): ImagesByIndexMap {
  return new Map();
}

interface ApplicationStageContentProps {
  gridLayout: GridLayout;
  imagesByIndex: ImagesByIndexMap;
  onOpenImage: () => void;
  activeAction: RegisteredViewportAction | null;
  sourceViewport: ToolOptionsSourceViewport | null;
  loadedReferenceCandidates: ReadonlyArray<LoadedReferenceCandidate>;
  toolOptionsEmbeddedEditor: ReactNode;
  isMasksToolActive: boolean;
  masksTarget: MasksOptionsTarget | null;
  onChangeMasks: (next: MaskPanelState) => void;
  maskBrush: MaskBrushSettings;
  onChangeMaskBrush: (next: MaskBrushSettings) => void;
  onCloseMasks: () => void;
  isNpcPanelOpen: boolean;
  npcTarget: NpcPanelTarget | null;
  onRecordNpcScore: (appliedLabel: string) => void;
  onCloseNpcPanel: () => void;
  isCnrPanelOpen: boolean;
  cnrTarget: CnrPanelTarget | null;
  onRecordCnrScore: (appliedLabel: string) => void;
  onCloseCnrPanel: () => void;
  isRopPanelOpen: boolean;
  ropTarget: RopPanelTarget | null;
  ropRepinOffer: RopRepinOffer;
  ropCandidateDelivery: RopCandidateDeliveryPort;
  onKeepRopCandidateAsNewStack: (request: RopKeepRequest) => void;
  onCloseRopPanel: () => void;
  rightPanelActiveSource: ViewportRightPanelActiveSource | null;
  onCancelAction: () => void;
  onApplyAction: (options: ToolOptionsApplyOptions) => void;
  onActiveActionParametersChange: (values: ParameterValuesById) => void;
  onBeginRegionRequest: () => void;
  onClearOperationRegion: () => void;
}

function ApplicationStageContent(props: ApplicationStageContentProps): JSX.Element {
  const { clearSelection } = useViewportSelection();
  return (
    <main className="flex min-h-0 flex-1">
      <div
        className="min-w-0 flex-1 p-4"
        onClick={(event) => clearSelectionWhenClickIsOutsideAnyCell(event, clearSelection)}
      >
        <ViewportGrid
          layout={props.gridLayout}
          cellsByIndex={props.imagesByIndex}
          onOpenImage={props.onOpenImage}
        />
      </div>
      {renderActiveRightSidePanel(props)}
    </main>
  );
}

function renderActiveRightSidePanel(props: ApplicationStageContentProps): JSX.Element | null {
  if (props.activeAction) {
    return (
      <ToolOptionsPanel
        action={props.activeAction}
        sourceViewport={props.sourceViewport}
        loadedReferenceCandidates={props.loadedReferenceCandidates}
        embeddedEditor={props.toolOptionsEmbeddedEditor}
        onCancel={props.onCancelAction}
        onApply={props.onApplyAction}
        onParametersChange={props.onActiveActionParametersChange}
        onBeginRegionRequest={props.onBeginRegionRequest}
        onClearOperationRegion={props.onClearOperationRegion}
      />
    );
  }
  if (props.isRopPanelOpen) {
    return (
      <RopOptionsPanel
        target={props.ropTarget}
        candidateDelivery={props.ropCandidateDelivery}
        repinOffer={props.ropRepinOffer}
        onKeepCandidateAsNewStack={props.onKeepRopCandidateAsNewStack}
        onClose={props.onCloseRopPanel}
      />
    );
  }
  if (props.isNpcPanelOpen) {
    return (
      <NpcOptionsPanel
        target={props.npcTarget}
        onRecordScoreInHistory={props.onRecordNpcScore}
        onClose={props.onCloseNpcPanel}
      />
    );
  }
  if (props.isCnrPanelOpen) {
    return (
      <CnrOptionsPanel
        target={props.cnrTarget}
        onRecordScoreInHistory={props.onRecordCnrScore}
        onClose={props.onCloseCnrPanel}
      />
    );
  }
  if (props.isMasksToolActive) {
    return (
      <MasksOptionsPanel
        target={props.masksTarget}
        onChangeMasks={props.onChangeMasks}
        brush={props.maskBrush}
        onChangeBrush={props.onChangeMaskBrush}
        loadedReferenceCandidates={props.loadedReferenceCandidates}
        onClose={props.onCloseMasks}
      />
    );
  }
  return <ViewportRightPanel activeSource={props.rightPanelActiveSource} />;
}

// CT-302: the Masks aside always edits the ACTIVE panel: its spatial size fixes
// the size of every new layer, and its rendering state holds the layers.
function deriveMasksOptionsTargetOrNull(
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): MasksOptionsTarget | null {
  if (!singleSelectedSource) return null;
  const content = imagesByIndex.get(singleSelectedSource.index);
  if (!content) return null;
  const dimensions = getImageSourceDimensions(content.source);
  return {
    viewportNumber: singleSelectedSource.summary.viewportNumber,
    fileName: content.fileName,
    width: dimensions.width,
    height: dimensions.height,
    masks: renderingApi.getRenderingState(singleSelectedSource.index).masks,
  };
}

// CT-308: NPC reads the ACTIVE panel's cube and that panel's mask layers, so it
// is offered only for a raster stack (a browser-decoded photo has no cube).
function deriveNpcPanelTargetOrNull(
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): NpcPanelTarget | null {
  if (!singleSelectedSource) return null;
  const content = imagesByIndex.get(singleSelectedSource.index);
  if (!content || content.source.kind !== "raster") return null;
  return {
    viewportIndex: singleSelectedSource.index,
    viewportNumber: singleSelectedSource.summary.viewportNumber,
    raster: content.source.raster,
    masks: renderingApi.getRenderingState(singleSelectedSource.index).masks,
  };
}

// CT-320: CNR reads exactly what NPC reads - the active panel's cube and that
// panel's mask layers - so the two asides share one derivation.
function deriveCnrPanelTargetOrNull(
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): CnrPanelTarget | null {
  return deriveNpcPanelTargetOrNull(singleSelectedSource, imagesByIndex, renderingApi);
}

// CT-315: ROP reads the PINNED panel's cube (CT-309 read the active panel), so
// a result panel arriving and stealing the selection cannot retarget the aside.
// The masks still come from that same panel and feed the scoring objectives.
function deriveRopPanelTargetOrNull(
  ropPin: RopPinnedPanel | null,
  renderingApi: ViewportRenderingApi,
): RopPanelTarget | null {
  if (!ropPin) return null;
  return {
    viewportIndex: ropPin.viewportIndex,
    viewportNumber: ropPin.viewportNumber,
    raster: ropPin.raster,
    masks: renderingApi.getRenderingState(ropPin.viewportIndex).masks,
  };
}

// CT-333: the offer behind "Use selected panel". It is the repin the button
// WOULD make, and null whenever that press would change nothing: no single
// panel selected, the selected panel holds no raster, or it is already pinned.
function deriveRopRepinTargetOrNull(
  ropPin: RopPinnedPanel | null,
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
): RopPinnedPanel | null {
  const selection = toRopPinSelectionOrNull(singleSelectedSource);
  const repinned = repinRopToSelection(ropPin, selection, imagesByIndex);
  return repinned === ropPin ? null : repinned;
}

function toRopPinSelectionOrNull(
  singleSelectedSource: SingleSelectedSource | null,
): RopPinSelection | null {
  if (!singleSelectedSource) return null;
  return {
    viewportIndex: singleSelectedSource.index,
    viewportNumber: singleSelectedSource.summary.viewportNumber,
  };
}

// The pin is derived during render and merely REMEMBERED here, so the aside
// never renders a frame against a target the selection has already moved off.
function useRopPinRetainedAcrossSelectionChanges(
  ropPin: RopPinnedPanel | null,
  pinnedRopPanel: RopPinnedPanel | null,
  setPinnedRopPanel: Dispatch<SetStateAction<RopPinnedPanel | null>>,
): void {
  useEffect(() => {
    if (ropPin !== pinnedRopPanel) setPinnedRopPanel(ropPin);
  }, [ropPin, pinnedRopPanel, setPinnedRopPanel]);
}

interface RopPinnedPanelLossBindings {
  readonly isRopPanelOpen: boolean;
  readonly pinnedRopPanel: RopPinnedPanel | null;
  readonly imagesByIndex: ImagesByIndexMap;
  readonly setIsRopPanelOpen: Dispatch<SetStateAction<boolean>>;
}

// Closing the pinned panel leaves the aside with nothing to project, so the
// aside closes with it rather than falling back to whatever is selected.
function useRopAsideClosedWithItsPinnedPanel(bindings: RopPinnedPanelLossBindings): void {
  const { isRopPanelOpen, pinnedRopPanel, imagesByIndex, setIsRopPanelOpen } = bindings;
  useEffect(() => {
    if (!isRopPanelOpen) return;
    if (hasPinnedRopPanelLostItsRaster(pinnedRopPanel, imagesByIndex)) setIsRopPanelOpen(false);
  }, [isRopPanelOpen, pinnedRopPanel, imagesByIndex, setIsRopPanelOpen]);
}

function keepRopCandidateFromPinnedPanel(
  request: RopKeepRequest,
  ropPin: RopPinnedPanel | null,
  bindings: ApplyActionFlowBindings,
): void {
  if (!ropPin) return;
  keepRopCandidateAsNewStack(request, ropPin.viewportIndex, bindings);
}

// The score is not an operation on the stack, so nothing about the panel
// changes; only the audit trail records that it was measured.
interface AnalysisHistoryEntryIdentity {
  readonly actionId: string;
  readonly actionLabel: string;
}

function appendAnalysisScoreToHistoryAtViewport(
  viewportIndex: number | null,
  analysis: AnalysisHistoryEntryIdentity,
  appliedLabel: string,
  renderingApi: ViewportRenderingApi,
): void {
  if (viewportIndex === null) return;
  const previous = renderingApi.getRenderingState(viewportIndex);
  renderingApi.setRenderingState(viewportIndex, {
    ...previous,
    operationHistory: appendOperationHistoryEntry(previous.operationHistory, {
      ...analysis,
      appliedLabel,
      parameterValues: NO_PARAMETER_VALUES,
    }),
  });
}

const NPC_ANALYSIS_ENTRY: AnalysisHistoryEntryIdentity = { actionId: "npc", actionLabel: "NPC" };
const CNR_ANALYSIS_ENTRY: AnalysisHistoryEntryIdentity = { actionId: "cnr", actionLabel: "CNR" };

function writeMaskPanelStateAtViewport(
  viewportIndex: number | null,
  masks: MaskPanelState,
  renderingApi: ViewportRenderingApi,
): void {
  if (viewportIndex === null) return;
  const previous = renderingApi.getRenderingState(viewportIndex);
  renderingApi.setRenderingState(viewportIndex, { ...previous, masks });
}

// CT-344: opening the Masks tool shows the active panel's overlay, so a user
// who had hidden it never opens the tool onto a blank canvas. Closing the
// tool leaves every panel's flag exactly as it is.
function toggleMasksToolShowingActivePanelOverlay(
  masksTool: MasksToolApi,
  activeViewportIndex: number | null,
  renderingApi: ViewportRenderingApi,
): void {
  if (activeViewportIndex !== null) {
    const previous = renderingApi.getRenderingState(activeViewportIndex);
    const masks = showMaskOverlayWhenOpeningMasksTool(previous.masks, masksTool.isMasksToolActive);
    if (masks !== previous.masks) writeMaskPanelStateAtViewport(activeViewportIndex, masks, renderingApi);
  }
  masksTool.toggleMasksTool();
}

function buildActiveOperationEmbeddedEditorOrNull(
  activeAction: RegisteredViewportAction | null,
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
  activeActionParameterValues: ParameterValuesById,
): ReactNode {
  return (
    buildActiveToneCurveEditorElementOrNull(activeAction, singleSelectedSource, imagesByIndex) ??
    buildActiveThresholdEditorElementOrNull(
      activeAction,
      singleSelectedSource,
      imagesByIndex,
      activeActionParameterValues,
    ) ??
    buildActiveBandWeightingEditorElementOrNull(activeAction, singleSelectedSource, imagesByIndex) ??
    buildActiveCustomTransformEditorElementOrNull(activeAction, singleSelectedSource, imagesByIndex)
  );
}

function buildActiveToneCurveEditorElementOrNull(
  activeAction: RegisteredViewportAction | null,
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
): ReactNode {
  if (!singleSelectedSource) return null;
  const content = imagesByIndex.get(singleSelectedSource.index);
  const placement = { activeActionId: activeAction?.id ?? null, sourceKind: content?.source.kind ?? null };
  if (!shouldEmbedToneCurveEditorInOperationPanel(placement)) return null;
  if (content?.source.kind !== "raster") return null;
  return (
    <ToolOptionsToneCurveEditor
      viewportIndex={singleSelectedSource.index}
      raster={content.source.raster}
    />
  );
}

function buildActiveThresholdEditorElementOrNull(
  activeAction: RegisteredViewportAction | null,
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
  activeActionParameterValues: ParameterValuesById,
): ReactNode {
  if (!singleSelectedSource) return null;
  const content = imagesByIndex.get(singleSelectedSource.index);
  const placement = {
    activeActionId: activeAction?.id ?? null,
    sourceKind: content?.source.kind ?? null,
    activeParameterValues: activeActionParameterValues,
  };
  if (!shouldEmbedThresholdEditorInOperationPanel(placement)) return null;
  if (content?.source.kind !== "raster") return null;
  return (
    <ToolOptionsThresholdEditor
      viewportIndex={singleSelectedSource.index}
      raster={content.source.raster}
    />
  );
}

function buildActiveBandWeightingEditorElementOrNull(
  activeAction: RegisteredViewportAction | null,
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
): ReactNode {
  if (!singleSelectedSource) return null;
  const content = imagesByIndex.get(singleSelectedSource.index);
  const placement = { activeActionId: activeAction?.id ?? null, sourceKind: content?.source.kind ?? null };
  if (!shouldEmbedBandWeightingEditorInOperationPanel(placement)) return null;
  if (content?.source.kind !== "raster") return null;
  return (
    <ToolOptionsBandWeightingEditor
      viewportIndex={singleSelectedSource.index}
      raster={content.source.raster}
    />
  );
}

function buildActiveCustomTransformEditorElementOrNull(
  activeAction: RegisteredViewportAction | null,
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
): ReactNode {
  if (!singleSelectedSource) return null;
  const content = imagesByIndex.get(singleSelectedSource.index);
  const placement = { activeActionId: activeAction?.id ?? null, sourceKind: content?.source.kind ?? null };
  if (!shouldEmbedCustomTransformEditorInOperationPanel(placement)) return null;
  if (content?.source.kind !== "raster") return null;
  return <ToolOptionsCustomTransformEditor viewportIndex={singleSelectedSource.index} />;
}

function clearSelectionWhenClickIsOutsideAnyCell(
  event: MouseEvent<HTMLElement>,
  clearSelection: () => void,
): void {
  const targetElement = event.target as HTMLElement;
  // Portaled overlays owned by grid content (e.g. the remove-band confirmation
  // dialog) live at document.body but bubble clicks through the React tree, so
  // only a click whose DOM target sits inside the stage counts as a stage click.
  if (!event.currentTarget.contains(targetElement)) return;
  if (targetElement.closest('[role="gridcell"]')) return;
  clearSelection();
}

function useMenuOpenImageTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuOpenImage(handler), [handler]);
}

function useMenuSaveImageTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuSaveImage(handler), [handler]);
}

function useMenuOpenProjectTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuOpenProject(handler), [handler]);
}

function useMenuSaveProjectTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuSaveProject(handler), [handler]);
}

function useMenuSaveProjectAsTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuSaveProjectAs(handler), [handler]);
}

function useMenuInvokeCommandHandler(handlers: OperationCommandHandlers): void {
  useEffect(
    () =>
      window.toolboxApi.onMenuInvokeCommand((commandId) =>
        dispatchOperationCommand(commandId, handlers),
      ),
    [handlers],
  );
}

// CT-289: the File > Grid submenu mirrors the toolbar's layout dropdown; both
// funnel into the same layout-change handler.
function useMenuSelectGridLayoutTriggersHandler(
  handler: (layout: GridLayout) => void,
): void {
  useEffect(
    () =>
      window.toolboxApi.onMenuSelectGridLayout((layout) => {
        if (isSelectableGridLayout(layout)) handler(layout);
      }),
    [handler],
  );
}

interface OperationCommandHandlerBindings {
  readonly regionTool: { readonly toggleRegionTool: () => void };
  readonly masksTool: { readonly toggleMasksTool: () => void };
  readonly bandSubsetToggle: BandSubsetToolbarToggleState;
  readonly openActionPanel: (action: RegisteredViewportAction) => void;
  readonly openNpcPanel: () => void;
  readonly openCnrPanel: () => void;
  readonly openRopPanel: () => void;
  readonly singleSelectedSource: SingleSelectedSource | null;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

function buildOperationCommandHandlers(
  bindings: OperationCommandHandlerBindings,
): OperationCommandHandlers {
  return {
    toggleRegionTool: bindings.regionTool.toggleRegionTool,
    toggleMasks: bindings.masksTool.toggleMasksTool,
    toggleBandSubset: bindings.bandSubsetToggle.onToggle,
    openActionPanel: bindings.openActionPanel,
    openNpcPanel: bindings.openNpcPanel,
    openCnrPanel: bindings.openCnrPanel,
    openRopPanel: bindings.openRopPanel,
    applyGeometricTransform: (transform) =>
      applyQuickGeometricTransformToActiveSource(
        transform,
        bindings.singleSelectedSource,
        bindings.applyActionFlowBindings,
      ),
  };
}

function applyQuickGeometricTransformToActiveSource(
  transform: GeometricTransform,
  source: SingleSelectedSource | null,
  bindings: ApplyActionFlowBindings,
): void {
  if (!source) return;
  applyActionInPlaceAtSourceIndex(
    findGeometricTransformActionForChoice(transform),
    { [GEOMETRIC_TRANSFORM_PARAMETER_ID]: transform },
    source.index,
    bindings,
  );
}

interface SaveImageRequestBindings {
  imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  renderingApi: ViewportRenderingApi;
  setPendingSaveImage: SetPendingSaveImage;
}

interface ConfirmSaveImageBindings {
  imagesByIndex: ImagesByIndexMap;
  renderingApi: ViewportRenderingApi;
  setPendingSaveImage: SetPendingSaveImage;
  busyRegistrar: BusyEntryRegistrar;
}

function useSaveImageRequestHandler(
  bindings: SaveImageRequestBindings,
): () => void {
  const { imagesByIndexRef, selectedIndicesRef, renderingApi, setPendingSaveImage } = bindings;
  return useCallback(() => {
    const candidate = pickSingleSelectedSourceWithContent(
      selectedIndicesRef.current,
      imagesByIndexRef.current,
    );
    if (!candidate) {
      toast.info("Select a panel with a loaded stack to save");
      return;
    }
    setPendingSaveImage(buildPendingSaveImageRequest(candidate, renderingApi));
  }, [imagesByIndexRef, selectedIndicesRef, renderingApi, setPendingSaveImage]);
}

function buildPendingSaveImageRequest(
  candidate: SingleSelectedContentSummary,
  renderingApi: ViewportRenderingApi,
): PendingSaveImageRequest {
  const selectedBandIndex = renderingApi.getRenderingState(candidate.index).selectedBandIndex;
  return {
    fileName: candidate.fileName,
    viewportIndex: candidate.index,
    isTrueColorPhoto: candidate.isTrueColorPhoto,
    isFloatSource: candidate.isFloatSource,
    bandCount: candidate.bandCount,
    selectedBandNumber: selectedBandIndex + 1,
  };
}

interface SingleSelectedContentSummary {
  readonly index: number;
  readonly fileName: string;
  readonly isTrueColorPhoto: boolean;
  readonly isFloatSource: boolean;
  readonly bandCount: number;
}

function pickSingleSelectedSourceWithContent(
  selectedIndices: ReadonlySet<number>,
  imagesByIndex: ImagesByIndexMap,
): SingleSelectedContentSummary | null {
  if (selectedIndices.size !== 1) return null;
  const onlyIndex = readSingleIndexFromSelection(selectedIndices);
  if (onlyIndex === null) return null;
  const content = imagesByIndex.get(onlyIndex);
  if (!content) return null;
  return {
    index: onlyIndex,
    fileName: content.fileName,
    isTrueColorPhoto: readIsTrueColorPhotoFromContent(content),
    isFloatSource: readIsFloatSourceFromContent(content),
    bandCount: readRasterBandCountFromContentOrNull(content) ?? 1,
  };
}

function readIsTrueColorPhotoFromContent(content: ViewportCellContent): boolean {
  if (content.source.kind !== "raster") return false;
  return shouldRenderRasterAsRgbComposite(content.source.raster);
}

function readIsFloatSourceFromContent(content: ViewportCellContent): boolean {
  return content.source.kind === "raster" && content.source.raster.sampleFormat === "float";
}

function confirmSaveImageFormatChoice(
  formatId: SaveImageFormatId,
  pending: PendingSaveImageRequest | null,
  bindings: ConfirmSaveImageBindings,
): void {
  bindings.setPendingSaveImage(null);
  if (!pending) return;
  const content = bindings.imagesByIndex.get(pending.viewportIndex);
  if (!content) return;
  const renderingState = bindings.renderingApi.getRenderingState(pending.viewportIndex);
  void runSaveImageFlowAndShowToast(
    {
      source: content.source,
      selectedBandIndex: renderingState.selectedBandIndex,
      originalFileName: content.fileName,
      formatId,
      displayMapping: readDisplayMappingStateForSaving(renderingState),
    },
    bindings.busyRegistrar,
  );
}

// CT-296: PNG and JPEG save the image AS VIEWED, so the save flow carries the
// panel's display-only toggles alongside the pixels.
function readDisplayMappingStateForSaving(
  renderingState: ViewportRenderingState,
): ViewportDisplayMappingState {
  return {
    normalizationEnabled: renderingState.normalizationEnabled,
  };
}

interface SaveImageFlowToastInput {
  source: ViewportCellContent["source"];
  selectedBandIndex: number;
  originalFileName: string;
  formatId: SaveImageFormatId;
  displayMapping: ViewportDisplayMappingState;
}

async function runSaveImageFlowAndShowToast(
  input: SaveImageFlowToastInput,
  busyRegistrar: BusyEntryRegistrar,
): Promise<void> {
  const handle = busyRegistrar.registerAppBusyEntry({
    label: `Saving ${input.originalFileName}...`,
  });
  try {
    const result = await runSaveImageFlowThroughMainProcess({
      ...input,
      onProgress: (fraction) => handle.update({ progress: fraction }),
    });
    if (result.canceled) return;
    notifySuccess(`Saved to ${result.filePath}`);
  } catch (error) {
    notifyError(buildSaveImageFailureToastText(input.originalFileName, describeUnknownError(error)));
  } finally {
    handle.clear();
  }
}

interface OpenImagesBindings {
  imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  gridLayoutRef: MutableRefObject<GridLayout>;
  setGridLayout: SetGridLayout;
  setImagesByIndex: SetImagesByIndex;
  setRenderingState: ViewportRenderingApi["setRenderingState"];
  setPendingOpenImagesReplace: SetPendingOpenImagesReplace;
  setPendingOpenImagesReview: SetPendingOpenImagesReview;
  selectViewportFromClick: SelectViewportFromClick;
  busyRegistrar: BusyEntryRegistrar;
}

function useOpenImagesThroughDialogHandler(
  bindings: OpenImagesBindings,
): () => Promise<void> {
  const {
    imagesByIndexRef,
    gridLayoutRef,
    setGridLayout,
    setImagesByIndex,
    setRenderingState,
    setPendingOpenImagesReplace,
    setPendingOpenImagesReview,
    selectViewportFromClick,
    busyRegistrar,
  } = bindings;
  return useCallback(
    () =>
      runOpenImagesDialogFlow({
        imagesByIndexRef,
        gridLayoutRef,
        setGridLayout,
        setImagesByIndex,
        setRenderingState,
        setPendingOpenImagesReplace,
        setPendingOpenImagesReview,
        selectViewportFromClick,
        busyRegistrar,
      }),
    [
      imagesByIndexRef,
      gridLayoutRef,
      setGridLayout,
      setImagesByIndex,
      setRenderingState,
      setPendingOpenImagesReplace,
      setPendingOpenImagesReview,
      selectViewportFromClick,
      busyRegistrar,
    ],
  );
}

async function runOpenImagesDialogFlow(bindings: OpenImagesBindings): Promise<void> {
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: "Reading files...",
    progress: 0,
  });
  try {
    await runOpenImagesDialogPhaseAndDispatchOutcome(bindings, handle);
  } catch (error) {
    notifyError(`Could not open images: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
}

async function runOpenImagesDialogPhaseAndDispatchOutcome(
  bindings: OpenImagesBindings,
  handle: BusyEntryHandle,
): Promise<void> {
  const result = await runOpenImagesDialogPhase({
    readPhaseBusyHandle: handle,
    remainingRasterBudgetBytes: remainingRasterBudgetBytesForViewports(bindings.imagesByIndexRef.current),
  });
  if (result.kind === "canceled") return;
  if (result.kind === "single-file") {
    handle.clear();
    await readSingleFileShowingViewportProgressThenPlace(result.metadata, bindings);
    return;
  }
  bindings.setPendingOpenImagesReview(result.proposal);
}

// CT-239: how much of the renderer's ArrayBuffer pool the panels currently
// open leave for a new allocation (opens, duplicates, re-imports).
function remainingRasterBudgetBytesForViewports(imagesByIndex: ImagesByIndexMap): number {
  return remainingRasterMemoryBudgetBytes(
    sumLiveRasterBytesAcrossSources([...imagesByIndex.values()].map((content) => content.source)),
  );
}

// CT-220: the single-file fast path reserves its destination cell FIRST so the read
// and decode can report determinate progress on that viewport's busy overlay instead
// of the app-wide read modal.
async function readSingleFileShowingViewportProgressThenPlace(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  bindings: OpenImagesBindings,
): Promise<void> {
  const targetIndex = reserveViewportCellForSingleFileOpen(bindings);
  const handle = registerSingleFileReadBusyEntry(metadata.fileName, targetIndex, bindings);
  try {
    const file = await readAndDecodeSingleOpenedImageFile(
      metadata,
      (fraction) => handle.update({ progress: fraction }),
      { remainingRasterBudgetBytes: remainingRasterBudgetBytesForViewports(bindings.imagesByIndexRef.current) },
    );
    placeSingleDecodedFileIntoViewport(file, targetIndex, bindings);
  } finally {
    handle.clear();
  }
}

function reserveViewportCellForSingleFileOpen(bindings: OpenImagesBindings): number | null {
  const plan = planOpenImagePlacement({
    currentLayout: bindings.gridLayoutRef.current,
    imagesByIndex: bindings.imagesByIndexRef.current,
  });
  if (plan.kind === "promptReplace") return null;
  if (plan.kind === "growGridAndPlace") bindings.setGridLayout(plan.expandedLayout);
  return plan.targetIndex;
}

function registerSingleFileReadBusyEntry(
  fileName: string,
  targetIndex: number | null,
  bindings: OpenImagesBindings,
): BusyEntryHandle {
  const label = `Reading ${fileName}...`;
  if (targetIndex === null) {
    return bindings.busyRegistrar.registerAppBusyEntry({ label });
  }
  return bindings.busyRegistrar.registerViewportBusyEntry({ label, viewportIndex: targetIndex });
}

function placeSingleDecodedFileIntoViewport(
  file: OpenedFileForGrouping,
  targetIndex: number | null,
  bindings: OpenImagesBindings,
): void {
  if (file.decodeError !== null || file.source === null) {
    notifyError(`Could not open ${file.fileName}: ${file.decodeError ?? "decode failed"}`);
    return;
  }
  routeSingleDecodedSourceToCell(file, targetIndex, bindings);
}

function routeSingleDecodedSourceToCell(
  file: OpenedFileForGrouping,
  targetIndex: number | null,
  bindings: OpenImagesBindings,
): void {
  const pending: PendingOpenImageReplaceItem = {
    fileName: file.fileName,
    source: file.source!,
    originalFilePath: file.filePath,
    fileSizeBytes: file.fileSizeBytes,
  };
  if (targetIndex === null) {
    bindings.setPendingOpenImagesReplace({ items: [pending] });
    return;
  }
  applyLoadedImageAtIndex(targetIndex, pending, bindings);
}

interface ApplyLoadedImageBindings {
  setImagesByIndex: SetImagesByIndex;
  setRenderingState: ViewportRenderingApi["setRenderingState"];
  selectViewportFromClick: SelectViewportFromClick;
}

function applyLoadedImageAtIndex(
  index: number,
  pending: PendingOpenImageReplaceItem,
  bindings: ApplyLoadedImageBindings,
): void {
  // CT-172: promote a browser-decoded photo to a raster on the way into the viewport so the
  // panel behaves like any other image (raster operations, histogram, tone curve). A source
  // that is already a raster (TIFF/ENVI/stack) is returned unchanged.
  const rasterSource = coerceViewportSourceToRasterSource(pending.source);
  replaceViewportContentResettingPanelState(
    index,
    {
      fileName: pending.fileName,
      source: rasterSource,
      originalFilePath: pending.originalFilePath,
      fileSizeBytes: pending.fileSizeBytes,
    },
    bindings,
  );
  bindings.selectViewportFromClick(index, { ctrlOrMeta: false, shift: false });
  notifySuccess(`Loaded ${pending.fileName}`);
}

interface ConfirmReplaceBindings extends ApplyLoadedImageBindings {
  setPendingOpenImagesReplace: SetPendingOpenImagesReplace;
}

function confirmOpenImagesReplaceWithAssignments(
  plan: ConfirmedOpenImagesReplacePlan,
  pending: PendingOpenImagesReplace | null,
  bindings: ConfirmReplaceBindings,
): void {
  bindings.setPendingOpenImagesReplace(null);
  if (!pending) return;
  for (const { itemIndex, targetIndex } of plan.assignments) {
    const item = pending.items[itemIndex];
    if (!item) continue;
    applyLoadedImageAtIndex(targetIndex, item, bindings);
  }
}

interface ConfirmReviewBindings extends OpenImagesBindings {
  setPendingOpenImagesReview: SetPendingOpenImagesReview;
}

async function confirmOpenImagesReviewGroups(
  groups: ReadonlyArray<OpenedFilesGroup>,
  bindings: ConfirmReviewBindings,
): Promise<void> {
  bindings.setPendingOpenImagesReview(null);
  try {
    const pendingItems = await buildPendingItemsFromConfirmedGroups(groups, bindings);
    if (pendingItems.length === 0) return;
    placePendingItemsAcrossViewports(pendingItems, bindings);
  } catch (error) {
    notifyError(`Could not place stacks: ${describeUnknownError(error)}`);
  }
}

async function buildPendingItemsFromConfirmedGroups(
  groups: ReadonlyArray<OpenedFilesGroup>,
  bindings: ConfirmReviewBindings,
): Promise<ReadonlyArray<PendingOpenImageReplaceItem>> {
  const items: PendingOpenImageReplaceItem[] = [];
  for (const group of groups) {
    if (group.mode === "stack" && group.rows.length >= 2) {
      items.push(await buildStackedItemFromGroup(group, bindings));
    } else {
      for (const row of group.rows) items.push(buildSingleImageItemFromRow(row));
    }
  }
  return items;
}

async function buildStackedItemFromGroup(
  group: OpenedFilesGroup,
  bindings: ConfirmReviewBindings,
): Promise<PendingOpenImageReplaceItem> {
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: `Stacking ${group.rows.length} rows...`,
    progress: 0,
  });
  try {
    const entries = group.rows.map(convertGroupRowToDecodedStackEntry);
    const built = await buildConfirmedStackFromOrderedEntriesWithProgress(entries, handle);
    const fileSizeBytes = group.rows.reduce((sum, row) => sum + row.fileSizeBytes, 0);
    return {
      fileName: built.suggestedFileName,
      source: { kind: "raster", raster: built.raster },
      fileSizeBytes,
    };
  } finally {
    handle.clear();
  }
}

function convertGroupRowToDecodedStackEntry(row: GroupedOpenedFileRow): DecodedStackEntry {
  return {
    fileName: row.fileName,
    filePath: row.filePath,
    fileSizeBytes: row.fileSizeBytes,
    mtimeMs: row.mtimeMs,
    raster: row.source && row.source.kind === "raster" ? row.source.raster : null,
    decodeError: row.decodeError,
    wavelength: row.wavelength,
    differentiatingSubstring: row.differentiatingSubstring,
  };
}

function buildSingleImageItemFromRow(row: GroupedOpenedFileRow): PendingOpenImageReplaceItem {
  if (row.source === null) {
    throw new Error(`Cannot open ${row.fileName}: ${row.decodeError ?? "unknown decode error"}`);
  }
  return {
    fileName: row.fileName,
    source: row.source,
    originalFilePath: row.filePath,
    fileSizeBytes: row.fileSizeBytes,
  };
}

function placePendingItemsAcrossViewports(
  items: ReadonlyArray<PendingOpenImageReplaceItem>,
  bindings: ConfirmReviewBindings,
): void {
  const plan = planOpenImagesPlacement({
    currentLayout: bindings.gridLayoutRef.current,
    imagesByIndex: bindings.imagesByIndexRef.current,
    newItemCount: items.length,
  });
  applyOpenImagesPlacementPlan(plan, items, bindings);
}

function applyOpenImagesPlacementPlan(
  plan: OpenImagesPlacementPlan,
  items: ReadonlyArray<PendingOpenImageReplaceItem>,
  bindings: ConfirmReviewBindings,
): void {
  if (plan.kind === "growFillThenPromptReplace") {
    applyGrowFillThenPromptReplacePlan(plan, items, bindings);
    return;
  }
  if (plan.expandedLayout !== undefined) {
    bindings.setGridLayout(plan.expandedLayout);
  }
  placeItemsAtTargetIndices(plan.targetIndices, items, bindings);
}

function applyGrowFillThenPromptReplacePlan(
  plan: Extract<OpenImagesPlacementPlan, { kind: "growFillThenPromptReplace" }>,
  items: ReadonlyArray<PendingOpenImageReplaceItem>,
  bindings: ConfirmReviewBindings,
): void {
  if (plan.expandedLayout !== undefined) {
    bindings.setGridLayout(plan.expandedLayout);
  }
  placeItemsAtTargetIndices(plan.filledTargetIndices, items, bindings);
  const overflowItems = items.slice(plan.filledTargetIndices.length);
  if (overflowItems.length > 0) {
    bindings.setPendingOpenImagesReplace({ items: overflowItems });
  }
}

function placeItemsAtTargetIndices(
  targetIndices: ReadonlyArray<number>,
  items: ReadonlyArray<PendingOpenImageReplaceItem>,
  bindings: ApplyLoadedImageBindings,
): void {
  for (let i = 0; i < targetIndices.length && i < items.length; i++) {
    applyLoadedImageAtIndex(targetIndices[i]!, items[i]!, bindings);
  }
}

interface GridLayoutChangeBindings {
  currentLayout: GridLayout;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: (layout: GridLayout) => void;
  setImagesByIndex: SetImagesByIndex;
  pruneSelectionToCellCount: (cellCount: number) => void;
  pruneRenderingStateToCellCount: (cellCount: number) => void;
  pruneLinkGroupsToCellCount: (cellCount: number) => void;
}

function createGridLayoutChangeHandler(
  bindings: GridLayoutChangeBindings,
): (layout: GridLayout) => void {
  return (newLayout) => applyGridLayoutChange(newLayout, bindings);
}

function applyGridLayoutChange(newLayout: GridLayout, bindings: GridLayoutChangeBindings): void {
  if (newLayout === bindings.currentLayout) return;
  const newCellCount = getGridLayoutCellCount(newLayout);
  notifyAboutClosedLoadedViewports(bindings.imagesByIndex, newCellCount);
  bindings.setImagesByIndex(filterImagesToWithinCellCount(bindings.imagesByIndex, newCellCount));
  bindings.pruneSelectionToCellCount(newCellCount);
  bindings.pruneRenderingStateToCellCount(newCellCount);
  bindings.pruneLinkGroupsToCellCount(newCellCount);
  bindings.setGridLayout(newLayout);
}

function notifyAboutClosedLoadedViewports(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): void {
  const closed = collectClosedLoadedViewports(imagesByIndex, newCellCount);
  if (closed.length === 0) return;
  toast.info(formatClosedViewportsMessage(closed));
}

interface ClosedViewportSummary {
  readonly viewportNumber: number;
  readonly fileName: string;
}

function collectClosedLoadedViewports(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): ReadonlyArray<ClosedViewportSummary> {
  const closed: ClosedViewportSummary[] = [];
  for (const [index, content] of imagesByIndex) {
    if (index < newCellCount) continue;
    closed.push({
      viewportNumber: getViewportNumberFromIndex(index),
      fileName: content.fileName,
    });
  }
  return closed.sort((a, b) => a.viewportNumber - b.viewportNumber);
}

function formatClosedViewportsMessage(closed: ReadonlyArray<ClosedViewportSummary>): string {
  if (closed.length === 1) {
    const only = closed[0]!;
    return `Closed panel ${only.viewportNumber} (${only.fileName})`;
  }
  const list = closed.map((entry) => `${entry.viewportNumber} (${entry.fileName})`).join(", ");
  return `Closed panels: ${list}`;
}

function filterImagesToWithinCellCount(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): ImagesByIndexMap {
  const next = new Map<number, ViewportCellContent>();
  for (const [index, content] of imagesByIndex) {
    if (index < newCellCount) next.set(index, content);
  }
  return next;
}

interface ViewportDuplicationApiBindings {
  gridLayout: GridLayout;
  cellCount: number;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: SetGridLayout;
  setImagesByIndex: SetImagesByIndex;
  setPendingDuplicate: SetPendingDuplicate;
  getRenderingState: ViewportRenderingApi["getRenderingState"];
  setRenderingState: ViewportRenderingApi["setRenderingState"];
  inFlightApplyRuns: InFlightApplyRunStore;
}

function useViewportDuplicationApi(
  bindings: ViewportDuplicationApiBindings,
): ViewportDuplicationApi {
  const {
    gridLayout,
    cellCount,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    setPendingDuplicate,
    getRenderingState,
    setRenderingState,
    inFlightApplyRuns,
  } = bindings;
  return useMemo(
    () =>
      buildViewportDuplicationApi({
        gridLayout,
        cellCount,
        imagesByIndex,
        setGridLayout,
        setImagesByIndex,
        setPendingDuplicate,
        getRenderingState,
        setRenderingState,
        inFlightApplyRuns,
      }),
    [
      gridLayout,
      cellCount,
      imagesByIndex,
      setGridLayout,
      setImagesByIndex,
      setPendingDuplicate,
      getRenderingState,
      setRenderingState,
      inFlightApplyRuns,
    ],
  );
}

function buildViewportDuplicationApi(
  bindings: ViewportDuplicationApiBindings,
): ViewportDuplicationApi {
  return {
    hasSourceContent: (index) => bindings.imagesByIndex.has(index),
    requestDuplicate: (sourceIndex) => routeDuplicateRequest(bindings, sourceIndex),
  };
}

function routeDuplicateRequest(
  bindings: ViewportDuplicationApiBindings,
  sourceIndex: number,
): void {
  const sourceContent = bindings.imagesByIndex.get(sourceIndex);
  if (!sourceContent) return;
  if (reportDuplicateExceedsMemoryBudget(bindings, sourceContent)) return;
  if (placeDuplicateInExistingEmptyViewport(bindings, sourceContent, sourceIndex)) return;
  if (placeDuplicateByExpandingGrid(bindings, sourceContent, sourceIndex)) return;
  bindings.setPendingDuplicate({ sourceIndex, sourceContent });
}

// CT-239: a duplicate deep-clones the whole cube; refuse before allocating when
// the clone cannot fit in the renderer's ArrayBuffer pool alongside the panels
// already open.
function reportDuplicateExceedsMemoryBudget(
  bindings: ViewportDuplicationApiBindings,
  sourceContent: ViewportCellContent,
): boolean {
  const liveBytes = sumLiveRasterBytesAcrossSources(
    [...bindings.imagesByIndex.values()].map((content) => content.source),
  );
  if (!rasterAllocationExceedsMemoryBudget(estimateSourceCloneBytes(sourceContent.source), liveBytes)) {
    return false;
  }
  notifyError(`Could not duplicate ${sourceContent.fileName}: ${DUPLICATE_MEMORY_REFUSAL_MESSAGE}`);
  return true;
}

function placeDuplicateInExistingEmptyViewport(
  bindings: ViewportDuplicationApiBindings,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
): boolean {
  const emptyIndex = findLowestIndexEmptyViewport(
    bindings.imagesByIndex,
    bindings.cellCount,
    bindings.inFlightApplyRuns.listReservedResultTargetIndexes(),
  );
  if (emptyIndex === null) return false;
  void applyDuplicateToTargetIndex(sourceContent, sourceIndex, emptyIndex, bindings);
  return true;
}

function placeDuplicateByExpandingGrid(
  bindings: ViewportDuplicationApiBindings,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
): boolean {
  const expandedLayout = getNextLargerGridLayout(bindings.gridLayout);
  if (expandedLayout === null) return false;
  const newCellIndex = bindings.cellCount;
  bindings.setGridLayout(expandedLayout);
  void applyDuplicateToTargetIndex(sourceContent, sourceIndex, newCellIndex, bindings);
  return true;
}

interface DuplicateTargetBindings {
  setImagesByIndex: SetImagesByIndex;
  getRenderingState: ViewportRenderingApi["getRenderingState"];
  setRenderingState: ViewportRenderingApi["setRenderingState"];
}

async function applyDuplicateToTargetIndex(
  sourceContent: ViewportCellContent,
  sourceIndex: number,
  targetIndex: number,
  bindings: DuplicateTargetBindings,
): Promise<void> {
  try {
    await placeClonedSourceContentAtIndex(sourceContent, targetIndex, bindings.setImagesByIndex);
    bindings.setRenderingState(targetIndex, bindings.getRenderingState(sourceIndex));
    notifySuccess(formatDuplicateSuccessMessage(sourceContent.fileName, targetIndex));
  } catch (error) {
    notifyError(`Could not duplicate ${sourceContent.fileName}: ${describeUnknownError(error)}`);
  }
}

function formatDuplicateSuccessMessage(fileName: string, targetIndex: number): string {
  const targetNumber = getViewportNumberFromIndex(targetIndex);
  return `Duplicated ${fileName} to panel ${targetNumber}`;
}

interface ConfirmDuplicateReplaceBindings {
  setImagesByIndex: SetImagesByIndex;
  setPendingDuplicate: SetPendingDuplicate;
  applyActionFlowBindings: ApplyActionFlowBindings;
}

function confirmPendingDuplicateReplaceAtTargetIndex(
  targetIndex: number,
  pending: PendingDuplicateReplace | null,
  bindings: ConfirmDuplicateReplaceBindings,
): void {
  bindings.setPendingDuplicate(null);
  if (!pending) return;
  if (pending.postDuplicateAction) {
    void runDuplicateAndApplyAtTargetIndex(
      pending.postDuplicateAction.action,
      pending.postDuplicateAction.parameterValues,
      pending.sourceContent,
      pending.sourceIndex,
      targetIndex,
      bindings.applyActionFlowBindings,
    );
    return;
  }
  void applyDuplicateToTargetIndex(pending.sourceContent, pending.sourceIndex, targetIndex, {
    setImagesByIndex: bindings.setImagesByIndex,
    getRenderingState: bindings.applyActionFlowBindings.getRenderingState,
    setRenderingState: bindings.applyActionFlowBindings.setRenderingState,
  });
}

function buildDuplicateReplaceTargetEntries(
  pending: PendingDuplicateReplace | null,
  imagesByIndex: ImagesByIndexMap,
  cellCount: number,
): ReadonlyArray<DuplicateReplaceTargetEntry> {
  if (!pending) return [];
  const occupied = listOccupiedViewportEntries(imagesByIndex, cellCount, (content) => content.fileName);
  return occupied.filter((entry) => entry.index !== pending.sourceIndex);
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function useViewportClosingApi(bindings: ViewportClosingApiBindings): ViewportClosingApi {
  const {
    gridLayout,
    selectedIndices,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneRenderingStateToCellCount,
    compactRenderingStateAfterRemovingIndex,
    pruneSelectionToCellCount,
    compactSelectionAfterRemovingIndex,
    pruneLinkGroupsToCellCount,
    compactLinkGroupsAfterRemovingIndex,
    replaceSelection,
    inFlightApplyRuns,
  } = bindings;
  return useMemo(
    () =>
      buildViewportClosingApi({
        gridLayout,
        selectedIndices,
        imagesByIndex,
        setGridLayout,
        setImagesByIndex,
        pruneRenderingStateToCellCount,
        compactRenderingStateAfterRemovingIndex,
        pruneSelectionToCellCount,
        compactSelectionAfterRemovingIndex,
        pruneLinkGroupsToCellCount,
        compactLinkGroupsAfterRemovingIndex,
        replaceSelection,
        inFlightApplyRuns,
      }),
    [
      gridLayout,
      selectedIndices,
      imagesByIndex,
      setGridLayout,
      setImagesByIndex,
      pruneRenderingStateToCellCount,
      compactRenderingStateAfterRemovingIndex,
      pruneSelectionToCellCount,
      compactSelectionAfterRemovingIndex,
      pruneLinkGroupsToCellCount,
      compactLinkGroupsAfterRemovingIndex,
      replaceSelection,
      inFlightApplyRuns,
    ],
  );
}

interface ViewportReimportApiBindings {
  imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  setImagesByIndex: SetImagesByIndex;
  setRenderingState: ViewportRenderingApi["setRenderingState"];
  busyRegistrar: BusyEntryRegistrar;
}

function useViewportReimportApi(
  bindings: ViewportReimportApiBindings,
): ViewportReimportApi {
  const { imagesByIndexRef, setImagesByIndex, setRenderingState, busyRegistrar } = bindings;
  return useMemo(
    () => buildViewportReimportApi({ imagesByIndexRef, setImagesByIndex, setRenderingState, busyRegistrar }),
    [imagesByIndexRef, setImagesByIndex, setRenderingState, busyRegistrar],
  );
}

function buildViewportReimportApi(
  bindings: ViewportReimportApiBindings,
): ViewportReimportApi {
  return {
    requestReimport: (viewportIndex) =>
      void runReimportSourceFromDiskFlow(viewportIndex, bindings),
  };
}

async function runReimportSourceFromDiskFlow(
  viewportIndex: number,
  bindings: ViewportReimportApiBindings,
): Promise<void> {
  const result = await invokeOpenImageDialogForReimportSafely();
  if (!result || result.canceled) return;
  await replaceViewportSourceWithReimportedFile(viewportIndex, result.file, bindings);
}

async function invokeOpenImageDialogForReimportSafely(): Promise<ToolboxOpenImageDialogResult | null> {
  try {
    return await window.toolboxApi.openImageDialog();
  } catch (error) {
    notifyError(`Could not open the file dialog: ${describeUnknownError(error)}`);
    return null;
  }
}

// CT-234: the dialog reply is metadata only; the file's bytes stream through
// the chunked opened-image read protocol (the same path as the main open flow),
// so a re-import works at any size the 16 GiB openable limit allows.
async function replaceViewportSourceWithReimportedFile(
  viewportIndex: number,
  file: ToolboxOpenImagesDialogFileMetadataEntry,
  bindings: ViewportReimportApiBindings,
): Promise<void> {
  const handle = bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex,
    label: `Re-importing ${file.fileName}...`,
  });
  try {
    // The replaced panel's cube stays alive until the decode lands, so the
    // budget counts it: the transient peak really is old cube plus new cube.
    const decoded = await readAndDecodeSingleOpenedImageFileOrThrow(
      file,
      (fraction) => handle.update({ progress: fraction }),
      { remainingRasterBudgetBytes: remainingRasterBudgetBytesForViewports(bindings.imagesByIndexRef.current) },
    );
    const source = coerceViewportSourceToRasterSource(decoded.source);
    replaceViewportContentResettingPanelState(
      viewportIndex,
      {
        fileName: file.fileName,
        source,
        originalFilePath: file.filePath,
        fileSizeBytes: file.fileSizeBytes,
      },
      bindings,
    );
    notifySuccess(`Re-imported ${file.fileName}`);
  } catch (error) {
    notifyError(`Could not re-import ${file.fileName}: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
}

interface ToolPanelRegionRequestHandlerInputs {
  readonly activeSourceIndex: number | null;
  readonly regionRequest: RegionRequestApi;
  readonly renderingApi: ViewportRenderingApi;
  readonly setActiveAction: SetActiveAction;
}

interface ToolPanelRegionRequestHandlers {
  readonly openActionPanel: (action: RegisteredViewportAction) => void;
  readonly closeActionPanel: () => void;
  readonly beginRegionRequest: () => void;
  readonly clearOperationRegion: () => void;
}

// CT-308/CT-309: the analysis asides and the tool-options panel compete for
// the same right-side slot, so opening one from the menu closes any open
// operation panel (and its pending region request) AND the other analysis
// aside instead of hiding behind either.
function openAnalysisPanelClosingCompetingPanels(
  regionRequestHandlers: ToolPanelRegionRequestHandlers,
  setThisPanelOpen: (open: boolean) => void,
  setCompetingPanelsOpen: ReadonlyArray<(open: boolean) => void>,
): void {
  regionRequestHandlers.closeActionPanel();
  for (const setCompetingPanelOpen of setCompetingPanelsOpen) setCompetingPanelOpen(false);
  setThisPanelOpen(true);
}

function buildToolPanelRegionRequestHandlers(
  inputs: ToolPanelRegionRequestHandlerInputs,
): ToolPanelRegionRequestHandlers {
  return {
    openActionPanel: (action) => openToolPanelClearingAnyRegionRequest(action, inputs),
    closeActionPanel: () => closeToolPanelClearingAnyRegionRequest(inputs),
    beginRegionRequest: () => beginOperationRegionRequestForActiveSource(inputs),
    clearOperationRegion: () => clearOperationRegionOnActiveSource(inputs),
  };
}

function openToolPanelClearingAnyRegionRequest(
  action: RegisteredViewportAction,
  inputs: ToolPanelRegionRequestHandlerInputs,
): void {
  inputs.regionRequest.endRegionRequest();
  clearTransientOperationStateOnActiveSource(inputs);
  inputs.setActiveAction(action);
}

function closeToolPanelClearingAnyRegionRequest(inputs: ToolPanelRegionRequestHandlerInputs): void {
  inputs.regionRequest.endRegionRequest();
  clearTransientOperationStateOnActiveSource(inputs);
  inputs.setActiveAction(null);
}

function clearTransientOperationStateOnActiveSource(
  inputs: ToolPanelRegionRequestHandlerInputs,
): void {
  clearOperationRegionOnActiveSource(inputs);
  clearToneCurveAnchorsOnActiveSource(inputs);
  clearThresholdBoundsOnActiveSource(inputs);
  clearBandWeightsOnActiveSource(inputs);
  clearBandSelectionOnActiveSource(inputs);
  clearCubeTransformOnActiveSource(inputs);
}

function clearCubeTransformOnActiveSource(inputs: ToolPanelRegionRequestHandlerInputs): void {
  if (inputs.activeSourceIndex === null) return;
  const state = inputs.renderingApi.getRenderingState(inputs.activeSourceIndex);
  if (!hasCubeTransformEditingState(state)) return;
  inputs.renderingApi.setRenderingState(inputs.activeSourceIndex, clearCubeTransformEditingState(state));
}

function clearBandWeightsOnActiveSource(inputs: ToolPanelRegionRequestHandlerInputs): void {
  if (inputs.activeSourceIndex === null) return;
  const state = inputs.renderingApi.getRenderingState(inputs.activeSourceIndex);
  if (!hasBandWeightingEditingState(state)) return;
  inputs.renderingApi.setRenderingState(inputs.activeSourceIndex, clearBandWeightingEditingState(state));
}

function clearBandSelectionOnActiveSource(inputs: ToolPanelRegionRequestHandlerInputs): void {
  if (inputs.activeSourceIndex === null) return;
  const state = inputs.renderingApi.getRenderingState(inputs.activeSourceIndex);
  if (!hasBandSelectionEditingState(state)) return;
  inputs.renderingApi.setRenderingState(inputs.activeSourceIndex, clearBandSelectionEditingState(state));
}

function clearThresholdBoundsOnActiveSource(inputs: ToolPanelRegionRequestHandlerInputs): void {
  if (inputs.activeSourceIndex === null) return;
  const state = inputs.renderingApi.getRenderingState(inputs.activeSourceIndex);
  if (!hasThresholdEditingState(state)) return;
  inputs.renderingApi.setRenderingState(inputs.activeSourceIndex, clearThresholdEditingState(state));
}

function clearToneCurveAnchorsOnActiveSource(inputs: ToolPanelRegionRequestHandlerInputs): void {
  if (inputs.activeSourceIndex === null) return;
  const state = inputs.renderingApi.getRenderingState(inputs.activeSourceIndex);
  if (!hasToneCurveEditingState(state)) return;
  inputs.renderingApi.setRenderingState(inputs.activeSourceIndex, clearToneCurveEditingState(state));
}

function beginOperationRegionRequestForActiveSource(
  inputs: ToolPanelRegionRequestHandlerInputs,
): void {
  if (inputs.activeSourceIndex === null) return;
  inputs.regionRequest.beginRegionRequest(inputs.activeSourceIndex);
}

function clearOperationRegionOnActiveSource(inputs: ToolPanelRegionRequestHandlerInputs): void {
  if (inputs.activeSourceIndex === null) return;
  clearOperationRegionAtViewportIndex(inputs.activeSourceIndex, inputs.renderingApi);
}

interface DeselectionClearsOperationRegionBindings {
  readonly selectedIndices: ReadonlySet<number>;
  readonly renderingApi: ViewportRenderingApi;
}

// CT-261: a panel that leaves the selection loses its pending operation region,
// so switching to another panel mid-operation never strands a region box on the
// panel the user moved away from.
function useDeselectionClearsOperationRegionOnLeavingPanels(
  bindings: DeselectionClearsOperationRegionBindings,
): void {
  const { selectedIndices, renderingApi } = bindings;
  const previousSelectionRef = useRef(selectedIndices);
  useEffect(() => {
    const previousSelection = previousSelectionRef.current;
    previousSelectionRef.current = selectedIndices;
    clearOperationRegionOnViewportsLeavingSelection(previousSelection, selectedIndices, renderingApi);
  }, [selectedIndices, renderingApi]);
}

interface ApplyActionFlowBindingsInputs {
  gridLayout: GridLayout;
  cellCount: number;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: SetGridLayout;
  setImagesByIndex: SetImagesByIndex;
  setPendingDuplicate: SetPendingDuplicate;
  renderingApi: ViewportRenderingApi;
  replaceSelection: ViewportSelectionState["replaceSelection"];
  busyRegistrar: BusyEntryRegistrar;
  inFlightApplyRuns: InFlightApplyRunStore;
}

function buildApplyActionFlowBindings(
  inputs: ApplyActionFlowBindingsInputs,
): ApplyActionFlowBindings {
  return {
    gridLayout: inputs.gridLayout,
    cellCount: inputs.cellCount,
    imagesByIndex: inputs.imagesByIndex,
    setGridLayout: inputs.setGridLayout,
    setImagesByIndex: inputs.setImagesByIndex,
    setPendingDuplicate: inputs.setPendingDuplicate,
    getRenderingState: inputs.renderingApi.getRenderingState,
    setRenderingState: inputs.renderingApi.setRenderingState,
    selectViewportIndex: (index) => inputs.replaceSelection(new Set([index])),
    busyRegistrar: inputs.busyRegistrar,
    inFlightApplyRuns: inputs.inFlightApplyRuns,
  };
}

// CT-269: one in-flight apply run store per app session. Mutations bump a
// version state so close affordances (a reserved target panel's close button)
// re-render while queries stay synchronous for event handlers.
function useInFlightApplyRunStore(): InFlightApplyRunStore {
  const [, bumpRunsVersion] = useState(0);
  return useMemo(
    () => createInFlightApplyRunStore(() => bumpRunsVersion((version) => version + 1)),
    [],
  );
}

function deriveSingleSelectedSource(
  selectedIndices: ReadonlySet<number>,
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): SingleSelectedSource | null {
  if (selectedIndices.size !== 1) return null;
  const onlyIndex = readSingleIndexFromSelection(selectedIndices);
  if (onlyIndex === null) return null;
  const content = imagesByIndex.get(onlyIndex);
  if (!content) return null;
  const renderingState = renderingApi.getRenderingState(onlyIndex);
  return {
    index: onlyIndex,
    summary: {
      viewportNumber: getViewportNumberFromIndex(onlyIndex),
      fileName: content.fileName,
      operationRegion: renderingState.operationRegion,
      sourceBandCount: readRasterBandCountFromContentOrNull(content),
      selectedBandNumber: renderingState.selectedBandIndex + 1,
      isTrueColorComposite: readIsTrueColorPhotoFromContent(content),
      sourceWidth: content.source.kind === "raster" ? content.source.raster.width : null,
      sourceHeight: content.source.kind === "raster" ? content.source.raster.height : null,
      maskPanelState: renderingState.masks,
    },
  };
}

function readRasterBandCountFromContentOrNull(content: ViewportCellContent): number | null {
  return content.source.kind === "raster" ? content.source.raster.bandCount : null;
}

function useLoadedReferenceCandidates(
  imagesByIndex: ImagesByIndexMap,
): ReadonlyArray<LoadedReferenceCandidate> {
  const candidates = useMemo(
    () => buildLoadedReferenceCandidates(listLoadedRasterPanelEntries(imagesByIndex)),
    [imagesByIndex],
  );
  const releaseWorkVersion = useSyncExternalStore(
    subscribeToRasterBufferReleaseWork,
    readRasterBufferReleaseWorkVersion,
  );
  // CT-239: SYNC the store (evicting closed panels' entries) instead of
  // accumulating - the remember-only loop pinned every closed panel's cube.
  // CT-290: the flush runs AFTER the sync in the same post-commit effect, so a
  // replaced/closed raster is only detached once no component renders it and
  // the store no longer remembers it; queue/hold changes re-run the effect.
  useEffect(() => {
    syncReferenceStoreThenReleaseDeadRasterBuffers(candidates, imagesByIndex);
  }, [candidates, imagesByIndex, releaseWorkVersion]);
  return candidates;
}

function syncReferenceStoreThenReleaseDeadRasterBuffers(
  candidates: ReadonlyArray<LoadedReferenceCandidate>,
  imagesByIndex: ImagesByIndexMap,
): void {
  replaceRememberedPanelReferenceRasters(candidates);
  releaseQueuedRasterBuffersSkippingShared({
    liveSources: [...imagesByIndex.values()].map((content) => content.source),
    rememberedRasters: listRememberedReferenceRasters(),
  });
}

function listLoadedRasterPanelEntries(imagesByIndex: ImagesByIndexMap): LoadedPanelReferenceEntry[] {
  const entries: LoadedPanelReferenceEntry[] = [];
  for (const [index, content] of imagesByIndex) {
    if (content.source.kind !== "raster") continue;
    entries.push({
      viewportNumber: getViewportNumberFromIndex(index),
      fileName: content.fileName,
      raster: content.source.raster,
    });
  }
  return entries;
}

interface PublishActiveToolPreviewInputs {
  readonly activeAction: RegisteredViewportAction | null;
  readonly singleSelectedSource: SingleSelectedSource | null;
  readonly imagesByIndex: ImagesByIndexMap;
  readonly parameterValues: ParameterValuesById;
  readonly falseColorPreview: FalseColorPreviewApi;
  readonly toneCurvePreview: ToneCurvePreviewApi;
  readonly renderingApi: ViewportRenderingApi;
}

function usePublishActiveToolPreview(inputs: PublishActiveToolPreviewInputs): void {
  const falseColorSource = useFalseColorPreviewSource(inputs);
  const displayLutParts = useActiveToolDisplayLutPreviewParts(inputs);
  const sourceIndex = inputs.singleSelectedSource?.index ?? null;
  usePublishPreviewSourceForViewport(inputs.falseColorPreview.setPreview, falseColorSource, sourceIndex);
  usePublishToneCurvePreviewForViewport(inputs.toneCurvePreview.setPreview, displayLutParts, sourceIndex);
}

function useFalseColorPreviewSource(
  inputs: PublishActiveToolPreviewInputs,
): ViewportImageSource | null {
  const raster = resolveActiveToolRasterOrNull(inputs, "false-color");
  const assignment = useMemo(
    () => readFalseColorBandAssignment(inputs.parameterValues),
    [inputs.parameterValues],
  );
  return useMemo(
    () => buildFalseColorPreviewSourceRecordingAllocation(raster, assignment),
    [raster, assignment],
  );
}

function buildFalseColorPreviewSourceRecordingAllocation(
  raster: RasterImage | null,
  assignment: FalseColorBandAssignment,
): ViewportImageSource | null {
  if (!raster) return null;
  const source = buildFalseColorPreviewSourceOrNull(raster, assignment);
  if (source) recordPreviewRasterAllocation();
  return source;
}

// CT-171/CT-177: the tone-curve preview is display-only - it publishes GPU lookup
// table(s) rather than a baked preview raster, so editing anchors never re-uploads
// the image texture (proven by the render-instrumentation counters). A scientific
// stack / single-band photo publishes ONE LUT; a true-colour composite publishes a
// per-channel triple (each channel's curve folded with the rgb/Value curve).
interface ToneCurvePreviewParts {
  readonly lookupTable: ReadonlyArray<number> | null;
  readonly channelLookupTables: ToneCurveChannelPreviewLuts | null;
}

function useActiveToolDisplayLutPreviewParts(inputs: PublishActiveToolPreviewInputs): ToneCurvePreviewParts {
  const toneCurveRaster = resolveActiveToolRasterOrNull(inputs, "tone-curve");
  const index = inputs.singleSelectedSource?.index ?? null;
  const state = index !== null ? inputs.renderingApi.getRenderingState(index) : null;
  const toneCurveLut = useSingleBandToneCurvePreviewLut(toneCurveRaster, state);
  const brightnessContrastLut = useBrightnessContrastPreviewLut(inputs, state);
  const thresholdLut = useThresholdPreviewLut(inputs, state);
  const toneCurveChannelLuts = useCompositeToneCurvePreviewLuts(toneCurveRaster, state);
  const brightnessContrastChannelLuts = useBrightnessContrastCompositePreviewLuts(inputs);
  const lookupTable = toneCurveLut ?? brightnessContrastLut ?? thresholdLut;
  const channelLookupTables = toneCurveChannelLuts ?? brightnessContrastChannelLuts;
  return useMemo(() => ({ lookupTable, channelLookupTables }), [lookupTable, channelLookupTables]);
}

// CT-200: the manual threshold previews its binary result through the SAME
// single-band display-LUT slot (only one tool panel is open at a time). It
// tracks the VIEWED band only and stays display-only until Apply. CT-282: the
// preview belongs to the Manual method only - Otsu derives its cutoffs at
// Apply, so there is nothing to preview while it is selected.
function useThresholdPreviewLut(
  inputs: PublishActiveToolPreviewInputs,
  state: ViewportRenderingState | null,
): ReadonlyArray<number> | null {
  const raster = resolveActiveToolRasterOrNull(inputs, "threshold");
  const isComposite = raster !== null && shouldRenderRasterAsRgbComposite(raster);
  const isOtsuMethod =
    readThresholdMethodChoice(inputs.parameterValues) === OTSU_THRESHOLD_METHOD;
  const bandIndex = state?.selectedBandIndex ?? 0;
  const bounds = state?.thresholdBounds ?? null;
  return useMemo(
    () =>
      isComposite || isOtsuMethod ? null : buildThresholdPreviewLutOrNull(raster, bandIndex, bounds),
    [isComposite, isOtsuMethod, raster, bandIndex, bounds],
  );
}

// CT-186: brightness/contrast previews through the SAME single-band display LUT slot
// the tone curve uses (only one tool is open at a time). It tracks the VIEWED band
// only - even when "Apply to all bands" is on - and stays display-only until Apply.
// A composite previews through the per-channel triple below instead (CT-247).
function useBrightnessContrastPreviewLut(
  inputs: PublishActiveToolPreviewInputs,
  state: ViewportRenderingState | null,
): ReadonlyArray<number> | null {
  const raster = resolveActiveToolRasterOrNull(inputs, "brightness-contrast");
  const isComposite = raster !== null && shouldRenderRasterAsRgbComposite(raster);
  const bandIndex = state?.selectedBandIndex ?? 0;
  const brightnessPercent = readBrightnessPercent(inputs.parameterValues);
  const contrastRatio = readContrastRatio(inputs.parameterValues);
  return useMemo(
    () =>
      isComposite
        ? null
        : buildBrightnessContrastPreviewLutOrNull(raster, bandIndex, brightnessPercent, contrastRatio),
    [isComposite, raster, bandIndex, brightnessPercent, contrastRatio],
  );
}

// CT-247: a true-colour composite previews brightness/contrast live by remapping
// ALL THREE channels through the CT-177 per-channel LUT triple (the tone-curve
// composite path); display-only, the data readout is unchanged until Apply.
function useBrightnessContrastCompositePreviewLuts(
  inputs: PublishActiveToolPreviewInputs,
): ToneCurveChannelPreviewLuts | null {
  const raster = resolveActiveToolRasterOrNull(inputs, "brightness-contrast");
  const brightnessPercent = readBrightnessPercent(inputs.parameterValues);
  const contrastRatio = readContrastRatio(inputs.parameterValues);
  return useMemo(
    () => buildBrightnessContrastCompositePreviewLutsOrNull(raster, brightnessPercent, contrastRatio),
    [raster, brightnessPercent, contrastRatio],
  );
}

function useSingleBandToneCurvePreviewLut(
  raster: RasterImage | null,
  state: ViewportRenderingState | null,
): ReadonlyArray<number> | null {
  const isComposite = raster !== null && shouldRenderRasterAsRgbComposite(raster);
  const anchors = state?.toneCurveAnchors ?? null;
  const bandIndex = state?.selectedBandIndex ?? 0;
  return useMemo(
    () => (isComposite ? null : buildToneCurvePreviewLutOrNull(raster, bandIndex, anchors)),
    [isComposite, raster, bandIndex, anchors],
  );
}

function useCompositeToneCurvePreviewLuts(
  raster: RasterImage | null,
  state: ViewportRenderingState | null,
): ToneCurveChannelPreviewLuts | null {
  const channelAnchors = useMergedToneCurveChannelAnchors(state);
  const red = useComposedChannelPreviewLut(raster, "red", channelAnchors);
  const green = useComposedChannelPreviewLut(raster, "green", channelAnchors);
  const blue = useComposedChannelPreviewLut(raster, "blue", channelAnchors);
  const isActive = useMemo(
    () => isCompositeToneCurvePreviewActive(raster, channelAnchors),
    [raster, channelAnchors],
  );
  return useMemo(
    () => (isActive && red && green && blue ? { red, green, blue } : null),
    [isActive, red, green, blue],
  );
}

function useComposedChannelPreviewLut(
  raster: RasterImage | null,
  channel: ColorToneCurveChannel,
  channelAnchors: ToneCurveChannelAnchors,
): ReadonlyArray<number> | null {
  const channelCurveAnchors = channelAnchors[channel];
  const valueAnchors = channelAnchors.rgb;
  return useMemo(
    () => buildComposedChannelPreviewLutOrNull(raster, channel, channelCurveAnchors, valueAnchors),
    [raster, channel, channelCurveAnchors, valueAnchors],
  );
}

function useMergedToneCurveChannelAnchors(
  state: ViewportRenderingState | null,
): ToneCurveChannelAnchors {
  const channelAnchors = state?.toneCurveChannelAnchors ?? EMPTY_TONE_CURVE_CHANNEL_ANCHORS;
  const activeChannel = state?.toneCurveActiveChannel ?? DEFAULT_TONE_CURVE_CHANNEL;
  const activeAnchors = state?.toneCurveAnchors ?? null;
  return useMemo(
    () => mergeActiveToneCurveChannelAnchors(channelAnchors, activeChannel, activeAnchors),
    [channelAnchors, activeChannel, activeAnchors],
  );
}

function resolveActiveToolRasterOrNull(
  inputs: PublishActiveToolPreviewInputs,
  actionId: string,
): RasterImage | null {
  const { activeAction, singleSelectedSource, imagesByIndex } = inputs;
  if (!activeAction || activeAction.id !== actionId || !singleSelectedSource) return null;
  const content = imagesByIndex.get(singleSelectedSource.index);
  if (!content || content.source.kind !== "raster") return null;
  return content.source.raster;
}

function usePublishPreviewSourceForViewport(
  setPreview: FalseColorPreviewApi["setPreview"],
  previewSource: ViewportImageSource | null,
  sourceIndex: number | null,
): void {
  useEffect(() => {
    setPreview(buildFalseColorPreviewOrNull(previewSource, sourceIndex));
    return () => setPreview(null);
  }, [setPreview, previewSource, sourceIndex]);
}

function buildFalseColorPreviewOrNull(
  source: ViewportImageSource | null,
  sourceIndex: number | null,
): FalseColorPreview | null {
  if (source === null || sourceIndex === null) return null;
  return { viewportIndex: sourceIndex, source };
}

function usePublishToneCurvePreviewForViewport(
  setPreview: ToneCurvePreviewApi["setPreview"],
  parts: ToneCurvePreviewParts,
  sourceIndex: number | null,
): void {
  useEffect(() => {
    setPreview(buildToneCurvePreviewOrNull(parts, sourceIndex));
    return () => setPreview(null);
  }, [setPreview, parts, sourceIndex]);
}

function buildToneCurvePreviewOrNull(
  parts: ToneCurvePreviewParts,
  sourceIndex: number | null,
): ToneCurveLutPreview | null {
  if (sourceIndex === null) return null;
  if (parts.lookupTable === null && parts.channelLookupTables === null) return null;
  return {
    viewportIndex: sourceIndex,
    lookupTable: parts.lookupTable,
    channelLookupTables: parts.channelLookupTables,
  };
}

function readSingleIndexFromSelection(selection: ReadonlySet<number>): number | null {
  for (const index of selection) return index;
  return null;
}

interface DeriveRightPanelActiveSourceInputs {
  readonly selectedIndices: ReadonlySet<number>;
  readonly imagesByIndex: ImagesByIndexMap;
  readonly renderingApi: ViewportRenderingApi;
  readonly currentProjectFilePath: string | null;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

function deriveRightPanelActiveSourceFromSelection(
  inputs: DeriveRightPanelActiveSourceInputs,
): ViewportRightPanelActiveSource | null {
  const onlyIndex = readSingleSelectedIndexOrNull(inputs.selectedIndices);
  if (onlyIndex === null) return null;
  const content = inputs.imagesByIndex.get(onlyIndex) ?? null;
  return buildRightPanelActiveSource({
    viewportIndex: onlyIndex,
    content,
    renderingApi: inputs.renderingApi,
    currentProjectFilePath: inputs.currentProjectFilePath,
    applyActionFlowBindings: inputs.applyActionFlowBindings,
  });
}

function readSingleSelectedIndexOrNull(
  selectedIndices: ReadonlySet<number>,
): number | null {
  if (selectedIndices.size !== 1) return null;
  return readSingleIndexFromSelection(selectedIndices);
}

function extractRasterFromContentOrNull(
  content: ViewportCellContent | null,
): ViewportRightPanelActiveSource["raster"] {
  if (!content || content.source.kind !== "raster") return null;
  return content.source.raster;
}

function extractImageSourceKindFromContentOrNull(
  content: ViewportCellContent | null,
): ViewportRightPanelActiveSource["imageSourceKind"] {
  if (!content) return null;
  if (content.source.kind === "raster") return "raster";
  return "browser-source";
}

interface BuildRightPanelActiveSourceInputs {
  readonly viewportIndex: number;
  readonly content: ViewportCellContent | null;
  readonly renderingApi: ViewportRenderingApi;
  readonly currentProjectFilePath: string | null;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

function buildRightPanelActiveSource(
  inputs: BuildRightPanelActiveSourceInputs,
): ViewportRightPanelActiveSource {
  const { viewportIndex, content, renderingApi, currentProjectFilePath } = inputs;
  const renderingState = renderingApi.getRenderingState(viewportIndex);
  const raster = extractRasterFromContentOrNull(content);
  return {
    viewportIndex,
    viewportNumber: getViewportNumberFromIndex(viewportIndex),
    metadata: buildMetadataDisplayForActiveContentOrNull(content, currentProjectFilePath),
    raster,
    imageSourceKind: extractImageSourceKindFromContentOrNull(content),
    selectedBandIndex: renderingState.selectedBandIndex,
    onSelectBandIndex: (bandIndex) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        selectedBandIndex: bandIndex,
      }),
    removedBandIndexes: renderingState.removedBandIndexes,
    isBandSubsetEditModeActive: renderingState.isBandSubsetEditModeActive,
    onEnterBandSubsetEditMode: () =>
      setBandSubsetEditModeActiveAtViewport(viewportIndex, true, renderingApi),
    onExitBandSubsetEditMode: () =>
      setBandSubsetEditModeActiveAtViewport(viewportIndex, false, renderingApi),
    onApplyBandSubset: (options) =>
      runApplyBandSubsetForViewport({
        viewportIndex,
        raster,
        removedBandIndexes: options.removedBandIndexes,
        openInNewViewport: options.openInNewViewport,
        applyActionFlowBindings: inputs.applyActionFlowBindings,
      }),
    onApplyFunctionDerivedBand: (options) =>
      runApplyFunctionDerivedBandForViewport(
        viewportIndex,
        raster,
        options.openInNewViewport,
        inputs.applyActionFlowBindings,
      ),
    onApplyDuplicateBands: (options) =>
      runApplyDuplicateBandsForViewport({
        viewportIndex,
        raster,
        bandIndexesToDuplicate: options.bandIndexesToDuplicate,
        openInNewViewport: options.openInNewViewport,
        applyActionFlowBindings: inputs.applyActionFlowBindings,
      }),
    operationHistory: renderingState.operationHistory,
    roi: renderingState.roi,
    onClearRoi: () =>
      renderingApi.setRenderingState(viewportIndex, { ...renderingState, roi: null }),
    pinnedSpectra: renderingState.pinnedSpectra,
    pinnedRoiSpectra: renderingState.pinnedRoiSpectra,
    activeRoiMeanSpectrum: buildRoiMeanSpectrumForDisplayOrNull(raster, renderingState.roi),
    onRemovePinnedSpectrum: (spectrumId) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        pinnedSpectra: removePinnedSpectrumById(renderingState.pinnedSpectra, spectrumId),
      }),
    onRemovePinnedRoiSpectrum: (spectrumId) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        pinnedRoiSpectra: removeRoiSpectrumById(renderingState.pinnedRoiSpectra, spectrumId),
      }),
  };
}

interface ApplyBandSubsetInputs {
  readonly viewportIndex: number;
  readonly raster: ViewportRightPanelActiveSource["raster"];
  readonly removedBandIndexes: ReadonlyArray<number>;
  readonly openInNewViewport: boolean;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

function runApplyBandSubsetForViewport(inputs: ApplyBandSubsetInputs): void {
  const keptBandNumbers = pickKeptBandOriginalNumbersForSubsetOrNull(inputs);
  if (keptBandNumbers === null) return;
  invokeBandSubsetActionOnSourceViewport(
    inputs.viewportIndex,
    keptBandNumbers,
    inputs.openInNewViewport,
    inputs.applyActionFlowBindings,
  );
}

function pickKeptBandOriginalNumbersForSubsetOrNull(
  inputs: ApplyBandSubsetInputs,
): ReadonlyArray<number> | null {
  const { raster, removedBandIndexes } = inputs;
  if (!raster) {
    notifyError("Subset Bands requires a raster source.");
    return null;
  }
  const keptBandIndexes = listKeptBandIndexesFromRemoved(raster.bandCount, removedBandIndexes);
  if (keptBandIndexes.length === 0) {
    notifyError("Keep at least one band before applying.");
    return null;
  }
  if (keptBandIndexes.length === raster.bandCount) {
    toast.info("Uncheck a band to remove it on apply.");
    return null;
  }
  return keptBandIndexes.map((bandIndex) => getRasterBandOriginalNumber(raster, bandIndex));
}

function invokeBandSubsetActionOnSourceViewport(
  sourceIndex: number,
  keptBandNumbers: ReadonlyArray<number>,
  openInNewViewport: boolean,
  bindings: ApplyActionFlowBindings,
): void {
  const parameterValues = buildBandSubsetParameterValuesFromKeptNumbers(keptBandNumbers);
  if (openInNewViewport) {
    applyActionToDuplicateOfSource(BAND_SUBSET_ACTION, parameterValues, sourceIndex, bindings);
    return;
  }
  applyActionInPlaceAtSourceIndex(BAND_SUBSET_ACTION, parameterValues, sourceIndex, bindings);
}

// CT-284: the Subset Bands editor's "By function" mode applies through the
// band-selection action unchanged: the staged choice rides in the source's
// rendering state and merges into the audit parameters at Apply time, exactly
// as the old Band Selection panel applied.
function runApplyFunctionDerivedBandForViewport(
  sourceIndex: number,
  raster: RasterImage | null,
  openInNewViewport: boolean,
  bindings: ApplyActionFlowBindings,
): void {
  if (!raster) {
    notifyError("Subset Bands requires a raster source.");
    return;
  }
  const merged = mergeParameterValuesWithSourceRenderingState(
    BAND_SELECTION_ACTION,
    NO_PARAMETER_VALUES,
    bindings.getRenderingState(sourceIndex),
    "whole-image",
    raster,
  );
  if (merged === null) return;
  if (openInNewViewport) {
    applyActionToDuplicateOfSource(BAND_SELECTION_ACTION, merged, sourceIndex, bindings);
    return;
  }
  applyActionInPlaceAtSourceIndex(BAND_SELECTION_ACTION, merged, sourceIndex, bindings);
}

interface ApplyDuplicateBandsInputs {
  readonly viewportIndex: number;
  readonly raster: ViewportRightPanelActiveSource["raster"];
  readonly bandIndexesToDuplicate: ReadonlyArray<number>;
  readonly openInNewViewport: boolean;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

// CT-301: the Subset Bands editor's "Duplicate" mode. The editor works in
// CURRENT band indexes; App resolves them to ORIGINAL band numbers (the same
// indirection Subset Bands' own "keep bands" mode uses) before building the
// action's audit parameters.
function runApplyDuplicateBandsForViewport(inputs: ApplyDuplicateBandsInputs): void {
  const bandNumbers = pickDuplicateBandOriginalNumbersOrNull(inputs);
  if (bandNumbers === null) return;
  invokeDuplicateBandsActionOnSourceViewport(
    inputs.viewportIndex,
    bandNumbers,
    inputs.openInNewViewport,
    inputs.applyActionFlowBindings,
  );
}

function pickDuplicateBandOriginalNumbersOrNull(
  inputs: ApplyDuplicateBandsInputs,
): ReadonlyArray<number> | null {
  const { raster, bandIndexesToDuplicate } = inputs;
  if (!raster) {
    notifyError("Subset Bands requires a raster source.");
    return null;
  }
  if (bandIndexesToDuplicate.length === 0) {
    notifyError("Enter at least one band to duplicate.");
    return null;
  }
  return bandIndexesToDuplicate.map((bandIndex) => getRasterBandOriginalNumber(raster, bandIndex));
}

function invokeDuplicateBandsActionOnSourceViewport(
  sourceIndex: number,
  bandNumbersInOrder: ReadonlyArray<number>,
  openInNewViewport: boolean,
  bindings: ApplyActionFlowBindings,
): void {
  const parameterValues = buildDuplicateBandsParameterValuesFromBandNumbers(bandNumbersInOrder);
  if (openInNewViewport) {
    applyActionToDuplicateOfSource(DUPLICATE_BANDS_ACTION, parameterValues, sourceIndex, bindings);
    return;
  }
  applyActionInPlaceAtSourceIndex(DUPLICATE_BANDS_ACTION, parameterValues, sourceIndex, bindings);
}

function useViewportBandRemovalApi(
  bindingsRef: MutableRefObject<ApplyActionFlowBindings>,
): ViewportBandRemovalApi {
  return useMemo(
    () => ({
      removeBand: (viewportIndex: number, bandIndex: number) =>
        removeSingleBandFromViewportInPlace(viewportIndex, bandIndex, bindingsRef.current),
    }),
    [bindingsRef],
  );
}

function removeSingleBandFromViewportInPlace(
  viewportIndex: number,
  bandIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const raster = extractRasterFromContentOrNull(bindings.imagesByIndex.get(viewportIndex) ?? null);
  const keptBandNumbers = pickKeptBandNumbersAfterSingleRemovalOrNull(raster, bandIndex);
  if (keptBandNumbers === null) return;
  invokeBandSubsetActionOnSourceViewport(viewportIndex, keptBandNumbers, false, bindings);
}

function pickKeptBandNumbersAfterSingleRemovalOrNull(
  raster: RasterImage | null,
  removedBandIndex: number,
): ReadonlyArray<number> | null {
  if (!raster) {
    notifyError("Removing a band requires a raster source.");
    return null;
  }
  if (raster.bandCount <= 1) {
    toast.info("Cannot remove the last remaining band.");
    return null;
  }
  return listKeptBandOriginalNumbersAfterRemovingBand(raster, removedBandIndex);
}

function setBandSubsetEditModeActiveAtViewport(
  viewportIndex: number,
  isActive: boolean,
  renderingApi: ViewportRenderingApi,
): void {
  const previous = renderingApi.getRenderingState(viewportIndex);
  if (previous.isBandSubsetEditModeActive === isActive) return;
  // Leaving the editor also drops any staged "By function" choice (CT-284).
  const next = isActive
    ? { ...previous, isBandSubsetEditModeActive: true }
    : closeBandSubsetEditorAndClearFunctionChoice(previous);
  renderingApi.setRenderingState(viewportIndex, next);
}

function deriveBandSubsetToggleStateForToolbar(
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): BandSubsetToolbarToggleState {
  if (!singleSelectedSource) return DISABLED_BAND_SUBSET_TOOLBAR_TOGGLE;
  const viewportIndex = singleSelectedSource.index;
  const raster = extractRasterFromContentOrNull(imagesByIndex.get(viewportIndex) ?? null);
  if (!raster || raster.bandCount < 2) return DISABLED_BAND_SUBSET_TOOLBAR_TOGGLE;
  const isActive = renderingApi.getRenderingState(viewportIndex).isBandSubsetEditModeActive;
  return {
    isAvailable: true,
    isActive,
    onToggle: () => setBandSubsetEditModeActiveAtViewport(viewportIndex, !isActive, renderingApi),
  };
}

const DISABLED_BAND_SUBSET_TOOLBAR_TOGGLE: BandSubsetToolbarToggleState = {
  isAvailable: false,
  isActive: false,
  onToggle: () => {},
};

function buildRoiMeanSpectrumForDisplayOrNull(
  raster: ViewportRightPanelActiveSource["raster"],
  roi: ViewportRightPanelActiveSource["roi"],
): ViewportRightPanelActiveSource["activeRoiMeanSpectrum"] {
  if (!raster || !roi) return null;
  const spectrum = computeRoiMeanSpectrumOrNull(raster, roi);
  if (!spectrum) return null;
  return {
    bandMeans: spectrum.bandMeans,
    bandStandardDeviations: spectrum.bandStandardDeviations,
    samplePixelCount: spectrum.samplePixelCount,
  };
}

interface EscapeKeyClearRoiBindings {
  readonly selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  readonly renderingApi: ViewportRenderingApi;
}

function useEscapeKeyClearsActiveViewportRoi(bindings: EscapeKeyClearRoiBindings): void {
  const { selectedIndicesRef, renderingApi } = bindings;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void =>
      handleEscapeKeyForRoiClearing(event, { selectedIndicesRef, renderingApi });
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndicesRef, renderingApi]);
}

function handleEscapeKeyForRoiClearing(
  event: KeyboardEvent,
  bindings: EscapeKeyClearRoiBindings,
): void {
  if (event.key !== "Escape") return;
  if (isFocusInsideEditableElement(event.target)) return;
  clearRoiOnEverySelectedViewport(bindings);
}

function clearRoiOnEverySelectedViewport(bindings: EscapeKeyClearRoiBindings): void {
  for (const index of bindings.selectedIndicesRef.current) {
    const renderingState = bindings.renderingApi.getRenderingState(index);
    if (!renderingState.roi) continue;
    bindings.renderingApi.setRenderingState(index, { ...renderingState, roi: null });
  }
}

interface RegionToolDeselectClearRoiBindings {
  readonly isRegionToolActive: boolean;
  readonly cellCount: number;
  readonly renderingApi: ViewportRenderingApi;
}

function useRegionToolDeselectClearsInspectionRoi(
  bindings: RegionToolDeselectClearRoiBindings,
): void {
  const { isRegionToolActive, cellCount, renderingApi } = bindings;
  const wasRegionToolActiveRef = useRef(isRegionToolActive);
  useEffect(() => {
    if (wasRegionToolActiveRef.current && !isRegionToolActive) {
      clearInspectionRoiOnEveryViewport(cellCount, renderingApi);
    }
    wasRegionToolActiveRef.current = isRegionToolActive;
  }, [isRegionToolActive, cellCount, renderingApi]);
}

function clearInspectionRoiOnEveryViewport(
  cellCount: number,
  renderingApi: ViewportRenderingApi,
): void {
  for (let index = 0; index < cellCount; index += 1) {
    const renderingState = renderingApi.getRenderingState(index);
    if (!renderingState.roi) continue;
    renderingApi.setRenderingState(index, { ...renderingState, roi: null });
  }
}

function isFocusInsideEditableElement(eventTarget: EventTarget | null): boolean {
  if (!(eventTarget instanceof HTMLElement)) return false;
  const tagName = eventTarget.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return true;
  return eventTarget.isContentEditable;
}

function buildMetadataDisplayForActiveContentOrNull(
  content: ViewportCellContent | null,
  currentProjectFilePath: string | null,
): ViewportRightPanelActiveSource["metadata"] {
  if (!content) return null;
  return buildViewportImageMetadataDisplay({
    fileName: content.fileName,
    source: content.source,
    originalFilePath: content.originalFilePath,
    currentProjectFilePath,
  });
}

function runApplyActionFromPanel(
  action: RegisteredViewportAction | null,
  source: SingleSelectedSource | null,
  options: ToolOptionsApplyOptions,
  bindings: ApplyActionFlowBindings,
  setActiveAction: SetActiveAction,
): void {
  if (!action || !source) return;
  const merged = mergeParameterValuesWithSourceRenderingState(
    action,
    options.parameterValues,
    bindings.getRenderingState(source.index),
    options.applyScope,
    readRasterAtViewportIndexOrNull(bindings.imagesByIndex, source.index),
  );
  if (merged === null) return;
  const boundBindings = bindApplyOutcomeToPanelClosure(action, bindings, setActiveAction);
  if (options.openInNewViewport) {
    applyActionToDuplicateOfSource(action, merged, source.index, boundBindings);
  } else {
    applyActionInPlaceAtSourceIndex(action, merged, source.index, boundBindings);
  }
  if (!action.keepsPanelOpenUntilApplySucceeds) setActiveAction(null);
}

// An action with keepsPanelOpenUntilApplySucceeds (the Custom transform, whose
// Python runs at Apply) keeps its panel open through the run: success closes
// it, failure leaves it open with the configured input intact for correction.
function bindApplyOutcomeToPanelClosure(
  action: RegisteredViewportAction,
  bindings: ApplyActionFlowBindings,
  setActiveAction: SetActiveAction,
): ApplyActionFlowBindings {
  if (!action.keepsPanelOpenUntilApplySucceeds) return bindings;
  return {
    ...bindings,
    reportApplyOutcome: (outcome) => {
      if (outcome.succeeded) setActiveAction(null);
    },
  };
}

function deriveActionAvailabilityForActiveViewport(
  action: RegisteredViewportAction,
  source: SingleSelectedSource | null,
  renderingApi: ViewportRenderingApi,
): ActionAvailabilityForActiveViewport {
  if (!source) return { isAvailable: false };
  if (!action.isAvailableForActiveViewport) return { isAvailable: true };
  const renderingState = renderingApi.getRenderingState(source.index);
  if (action.isAvailableForActiveViewport(renderingState)) return { isAvailable: true };
  return {
    isAvailable: false,
    disabledReason: describeWhyActionIsUnavailableForViewport(action),
  };
}

function describeWhyActionIsUnavailableForViewport(_action: RegisteredViewportAction): string {
  return "not available for this panel";
}

function mergeParameterValuesWithSourceRenderingState(
  action: RegisteredViewportAction,
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
  applyScope: ApplyScope,
  sourceRaster: RasterImage | null,
): ParameterValuesById | null {
  if (!action.prepareParameterValuesForApply) return rawParameterValues;
  try {
    return action.prepareParameterValuesForApply(rawParameterValues, sourceRenderingState, applyScope, sourceRaster);
  } catch (error) {
    notifyError(formatActionPreparationErrorMessage(action.label, error));
    return null;
  }
}

function readRasterAtViewportIndexOrNull(
  imagesByIndex: ImagesByIndexMap,
  index: number,
): RasterImage | null {
  const source = imagesByIndex.get(index)?.source;
  if (!source || source.kind !== "raster") return null;
  return source.raster;
}

function formatActionPreparationErrorMessage(actionLabel: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${actionLabel} failed: ${message}`;
}

interface SaveProjectRequestBindings {
  readonly gridLayoutRef: MutableRefObject<GridLayout>;
  readonly imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  readonly selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  readonly renderingApi: ViewportRenderingApi;
  readonly currentProjectFilePathRef: MutableRefObject<string | null>;
  readonly setCurrentProjectFilePath: SetCurrentProjectFilePath;
  readonly projectRevisionTracker: ProjectContentRevisionTracker;
  readonly busyRegistrar: BusyEntryRegistrar;
}

interface SaveProjectRequestHandlers {
  readonly saveOrPromptForPath: () => void;
  readonly alwaysPromptForPath: () => void;
  readonly saveReportingSuccess: () => Promise<boolean>;
}

function useSaveProjectRequestHandler(
  bindings: SaveProjectRequestBindings,
): SaveProjectRequestHandlers {
  const saveOrPromptForPath = useCallback(
    () => void runSaveProjectFlowAndShowToast(bindings, false),
    [bindings],
  );
  const alwaysPromptForPath = useCallback(
    () => void runSaveProjectFlowAndShowToast(bindings, true),
    [bindings],
  );
  const saveReportingSuccess = useCallback(
    () => runSaveProjectFlowAndShowToast(bindings, false),
    [bindings],
  );
  return { saveOrPromptForPath, alwaysPromptForPath, saveReportingSuccess };
}

// Resolves true only when a bundle was actually written (the CT-258 close
// guard confirms the window close on that signal alone).
async function runSaveProjectFlowAndShowToast(
  bindings: SaveProjectRequestBindings,
  saveAs: boolean,
): Promise<boolean> {
  const revisionBeingSaved = bindings.projectRevisionTracker.readContentRevision();
  const snapshot = buildSaveableProjectSnapshotFromCurrentState(bindings);
  if (snapshot.viewports.length === 0) {
    toast.info("No panels with loaded files to save");
    return false;
  }
  return invokeSaveProjectFlowWithToastFeedback(snapshot, saveAs, bindings, revisionBeingSaved);
}

async function invokeSaveProjectFlowWithToastFeedback(
  snapshot: SaveableProjectSnapshot,
  saveAs: boolean,
  bindings: SaveProjectRequestBindings,
  revisionBeingSaved: number,
): Promise<boolean> {
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: "Saving project...",
    progress: 0,
  });
  try {
    await letBusyIndicatorPaintBeforeHeavySaveWork(snapshot);
    const result = await runSaveProjectBundleFlowThroughMainProcess({
      snapshot,
      currentProjectFilePath: bindings.currentProjectFilePathRef.current,
      saveAs,
      onProgress: (event) => updateSaveBundleProgressOnHandle(handle, event),
    });
    return handleSaveProjectFlowOutcome(result, bindings, revisionBeingSaved);
  } catch (error) {
    notifyError(`Could not save project: ${describeUnknownError(error)}`);
    return false;
  } finally {
    handle.clear();
  }
}

// When the save will re-encode a raster (the slow path), yield long enough for
// the "Saving project..." indicator to paint before the synchronous bake blocks
// the renderer thread, so the save never feels frozen (CT-072). Saves that only
// reference unmodified on-disk files skip the wait and stay flash-free.
async function letBusyIndicatorPaintBeforeHeavySaveWork(
  snapshot: SaveableProjectSnapshot,
): Promise<void> {
  if (!saveableSnapshotRequiresRasterRebake(snapshot)) return;
  await waitForBusyIndicatorToClearAntiFlashThreshold();
}

function updateSaveBundleProgressOnHandle(
  handle: BusyEntryHandle,
  event: { fraction: number },
): void {
  handle.update({ label: "Saving project...", progress: event.fraction });
}

function handleSaveProjectFlowOutcome(
  result: { canceled: boolean; filePath?: string },
  bindings: SaveProjectRequestBindings,
  revisionBeingSaved: number,
): boolean {
  if (result.canceled || !result.filePath) return false;
  bindings.setCurrentProjectFilePath(result.filePath);
  bindings.projectRevisionTracker.markContentRevisionAsSaved(revisionBeingSaved);
  notifySuccess(`Saved project to ${result.filePath}`);
  return true;
}

function buildSaveableProjectSnapshotFromCurrentState(
  bindings: PackOrSaveProjectSnapshotInputs,
): SaveableProjectSnapshot {
  const imagesByIndex = bindings.imagesByIndexRef.current;
  const renderingApi = bindings.renderingApi;
  return {
    gridLayout: bindings.gridLayoutRef.current,
    selectedViewportIndices: Array.from(bindings.selectedIndicesRef.current),
    viewports: collectSaveableViewportsFromImagesMap(imagesByIndex, renderingApi),
  };
}

interface PackOrSaveProjectSnapshotInputs {
  readonly gridLayoutRef: MutableRefObject<GridLayout>;
  readonly imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  readonly selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  readonly renderingApi: ViewportRenderingApi;
}

function collectSaveableViewportsFromImagesMap(
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): SaveableProjectSnapshot["viewports"] {
  const collected: SaveableProjectSnapshot["viewports"][number][] = [];
  for (const [index, content] of imagesByIndex) {
    collected.push(buildSaveableViewportEntry(index, content, renderingApi));
  }
  return collected.sort((a, b) => a.index - b.index);
}

function buildSaveableViewportEntry(
  index: number,
  content: ViewportCellContent,
  renderingApi: ViewportRenderingApi,
): SaveableProjectSnapshot["viewports"][number] {
  const renderingState = renderingApi.getRenderingState(index);
  return {
    index,
    fileName: content.fileName,
    source: content.source,
    originalFilePath: content.originalFilePath ?? null,
    renderingState: {
      normalizationEnabled: renderingState.normalizationEnabled,
      selectedBandIndex: renderingState.selectedBandIndex,
      lastAppliedOperationLabel: renderingState.lastAppliedOperationLabel,
    },
    operationHistory: renderingState.operationHistory.map((entry) => ({
      actionId: entry.actionId,
      actionLabel: entry.actionLabel,
      appliedLabel: entry.appliedLabel,
      parameterValues: { ...entry.parameterValues },
      timestampMs: entry.timestampMs,
    })),
    masks: renderingState.masks,
  };
}

interface OpenProjectRequestBindings {
  readonly setGridLayout: SetGridLayout;
  readonly setImagesByIndex: SetImagesByIndex;
  readonly setCurrentProjectFilePath: SetCurrentProjectFilePath;
  readonly projectRevisionTracker: ProjectContentRevisionTracker;
  readonly replaceAllRenderingStates: ViewportRenderingApi["replaceAllRenderingStates"];
  readonly replaceSelection: ViewportSelectionState["replaceSelection"];
  readonly busyRegistrar: BusyEntryRegistrar;
}

function useOpenProjectRequestHandler(
  bindings: OpenProjectRequestBindings,
): () => void {
  return useCallback(
    () => void runOpenProjectFlowAndShowToast(bindings),
    [bindings],
  );
}

async function runOpenProjectFlowAndShowToast(
  bindings: OpenProjectRequestBindings,
): Promise<void> {
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: "Opening project...",
    progress: 0,
  });
  try {
    const result = await runOpenProjectFlowThroughMainProcess({
      onProgress: (event) => updateOpenBundleProgressOnHandle(handle, event),
    });
    handleOpenProjectFlowOutcome(result, bindings);
  } catch (error) {
    notifyError(`Could not open project: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
}

function updateOpenBundleProgressOnHandle(
  handle: BusyEntryHandle,
  event: { readAssetCount: number; totalAssetCount: number; currentAssetFraction: number },
): void {
  const fraction =
    event.totalAssetCount === 0
      ? 1
      : (event.readAssetCount + event.currentAssetFraction) / event.totalAssetCount;
  handle.update({
    label: `Opening project... asset ${event.readAssetCount} of ${event.totalAssetCount}`,
    progress: fraction,
  });
}

function handleOpenProjectFlowOutcome(
  result: { canceled: boolean; opened?: OpenedProject },
  bindings: OpenProjectRequestBindings,
): void {
  if (result.canceled || !result.opened) return;
  applyOpenedProjectToApplicationState(result.opened, bindings);
  notifySuccess(formatOpenedProjectToastMessage(result.opened));
}

function formatOpenedProjectToastMessage(opened: OpenedProject): string {
  return `Opened project (${opened.resolvedViewports.length} viewports)`;
}

function applyOpenedProjectToApplicationState(
  opened: OpenedProject,
  bindings: OpenProjectRequestBindings,
): void {
  bindings.projectRevisionTracker.markNextContentChangeAsSaved();
  bindings.setGridLayout(opened.project.gridLayout);
  bindings.setImagesByIndex(buildImagesByIndexMapFromOpenedProject(opened));
  bindings.replaceAllRenderingStates(buildRenderingByIndexMapFromOpenedProject(opened));
  bindings.replaceSelection(new Set(opened.project.selectedViewportIndices));
  bindings.setCurrentProjectFilePath(opened.projectFilePath);
}

function buildImagesByIndexMapFromOpenedProject(opened: OpenedProject): ImagesByIndexMap {
  const next = new Map<number, ViewportCellContent>();
  for (const viewport of opened.resolvedViewports) {
    next.set(viewport.index, mapResolvedViewportSnapshotToCellContent(viewport));
  }
  return next;
}

function mapResolvedViewportSnapshotToCellContent(
  viewport: OpenedProjectViewportSnapshot,
): ViewportCellContent {
  return {
    fileName: viewport.fileName,
    source: viewport.source,
    originalFilePath: viewport.originalFilePath,
    fileSizeBytes: viewport.fileSizeBytes,
  };
}

function buildRenderingByIndexMapFromOpenedProject(
  opened: OpenedProject,
): ViewportRenderingByIndex {
  const next = new Map<number, ReturnType<ViewportRenderingApi["getRenderingState"]>>();
  for (const viewport of opened.resolvedViewports) {
    next.set(viewport.index, mapProjectRenderingStateToViewportRenderingState(viewport));
  }
  return next;
}

function mapProjectRenderingStateToViewportRenderingState(
  viewport: OpenedProjectViewportSnapshot,
): ReturnType<ViewportRenderingApi["getRenderingState"]> {
  return {
    ...DEFAULT_VIEWPORT_RENDERING_STATE,
    normalizationEnabled: viewport.entry.renderingState.normalizationEnabled,
    selectedBandIndex: viewport.entry.renderingState.selectedBandIndex,
    lastAppliedOperationLabel: viewport.entry.renderingState.lastAppliedOperationLabel,
    operationHistory: viewport.entry.operationHistory.map((entry) => ({
      actionId: entry.actionId,
      actionLabel: entry.actionLabel,
      appliedLabel: entry.appliedLabel,
      parameterValues: Object.freeze({ ...entry.parameterValues }),
      timestampMs: entry.timestampMs,
    })),
    masks: viewport.masks,
  };
}
