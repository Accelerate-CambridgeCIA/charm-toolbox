import { useId, useState, type Dispatch, type SetStateAction } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import {
  PANEL_NUMERIC_INPUT_CLASSES,
  PANEL_SELECT_CLASSES,
} from "@/components/form-control-classes";
import { PerBandScoreSection } from "@/components/per-band-score-section";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NPC_PANEL_ICON } from "@/lib/actions/operation-command-bindings";
import {
  describeNpcQualificationProblemOrNull,
  listMaskLayersQualifyingForNpc,
} from "@/lib/analysis/npc-qualification";
import {
  DEFAULT_NPC_BIN_COUNT,
  MIN_NPC_BIN_COUNT,
  parseNpcBinCountOrNull,
} from "@/lib/analysis/npc-run-request";
import {
  formatNpcHistoryAppliedLabel,
  formatNpcScoreToSignificantFigures,
} from "@/lib/analysis/npc-score-format";
import { selectTopScoringBandRows } from "@/lib/analysis/per-band-score-presentation";
import {
  computeNpcScoreShowingPanelBusy,
  type NpcAnalysisOutcome,
} from "@/lib/analysis/run-npc-analysis";
import { OPERATION_STOPPED_MESSAGE } from "@/lib/image/operation-stop";
import type { RasterImage } from "@/lib/image/raster-image";
import type { SpectrumPlotValueRange } from "@/lib/image/spectrum-plot-geometry";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";
import { notifyError } from "@/lib/notifications/notify";
import { cn } from "@/lib/utils";
import { useBusyEntryRegistrar, type BusyEntryRegistrar } from "@/state/busy-state-context";

// CT-308: the NPC aside. NPC scores how separable the active stack's labeled
// regions are, so it produces MEASUREMENTS, not a raster: there is no result
// destination and no Apply, only Compute plus a readout. The panel is unusable
// until the stack carries a mask layer with two painted categories, and says so
// in the locked vocabulary rather than silently disabling itself.
//
// CT-319: the readout is one score PER BAND, shown as a line plot against the
// stack's x axis plus a list of the best bands. Any change to the layer, the
// bin count or the stack itself returns it to the not-computed state, so a
// plot on screen always belongs to the settings on screen.

export interface NpcPanelTarget {
  readonly viewportIndex: number;
  readonly viewportNumber: number;
  readonly raster: RasterImage;
  readonly masks: MaskPanelState;
}

export interface NpcOptionsPanelProps {
  readonly target: NpcPanelTarget | null;
  readonly onRecordScoreInHistory: (appliedLabel: string) => void;
  readonly onClose: () => void;
}

export function NpcOptionsPanel(props: NpcOptionsPanelProps): JSX.Element {
  return (
    <aside aria-label="Potential Contrast options" className={NPC_PANEL_CLASSES}>
      <NpcPanelHeader
        viewportNumber={props.target?.viewportNumber ?? null}
        onClose={props.onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <NpcPanelBody
          target={props.target}
          onRecordScoreInHistory={props.onRecordScoreInHistory}
        />
      </div>
    </aside>
  );
}

const NPC_PANEL_CLASSES = "flex w-[300px] shrink-0 flex-col border-l bg-card";

interface NpcPanelHeaderProps {
  readonly viewportNumber: number | null;
  readonly onClose: () => void;
}

function NpcPanelHeader(props: NpcPanelHeaderProps): JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <NPC_PANEL_ICON className="size-4" aria-hidden="true" />
        NPC
      </span>
      <div className="flex items-center gap-2">
        {props.viewportNumber === null ? null : (
          <span className="text-xs text-muted-foreground">Panel {props.viewportNumber}</span>
        )}
        <NpcPanelCloseButton onClose={props.onClose} />
      </div>
    </div>
  );
}

function NpcPanelCloseButton({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Close Potential Contrast options" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Close Potential Contrast options</TooltipContent>
    </Tooltip>
  );
}

interface NpcPanelBodyProps {
  readonly target: NpcPanelTarget | null;
  readonly onRecordScoreInHistory: (appliedLabel: string) => void;
}

function NpcPanelBody(props: NpcPanelBodyProps): JSX.Element {
  const form = useNpcComputeForm(props.target);
  const problem = describeNpcQualificationProblemOrNull(props.target?.masks ?? null);
  return (
    <>
      <NpcExplanation />
      {problem === null ? null : <p className="text-xs text-muted-foreground">{problem}</p>}
      <NpcMaskLayerPicker form={form} isDisabled={problem !== null} />
      <NpcBinCountField form={form} isDisabled={problem !== null} />
      <NpcComputeButton
        isDisabled={!canComputeNpcNow(form, problem)}
        isComputing={form.isComputing}
        onCompute={() => void form.compute(props.onRecordScoreInHistory)}
      />
      <NpcPerBandScores raster={props.target?.raster ?? null} scores={form.scores} />
    </>
  );
}

function canComputeNpcNow(form: NpcComputeFormApi, problem: string | null): boolean {
  if (problem !== null || form.isComputing) return false;
  return form.selectedLayer !== null && form.binCount !== null;
}

function NpcExplanation(): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      Multi-Class Normalized Potential Contrast scores, band by band, how
      separable the mask layer&apos;s painted categories are. 1 is perfectly
      separable, 0 is indistinguishable.
    </p>
  );
}

interface NpcFieldProps {
  readonly form: NpcComputeFormApi;
  readonly isDisabled: boolean;
}

function NpcMaskLayerPicker(props: NpcFieldProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">Mask layer</span>
      <select
        id={id}
        aria-label="Mask layer"
        className={PANEL_SELECT_CLASSES}
        disabled={props.isDisabled}
        value={props.form.selectedLayer?.id ?? ""}
        onChange={(event) => props.form.selectLayer(event.target.value)}
      >
        <NpcMaskLayerOptions layers={props.form.qualifyingLayers} />
      </select>
    </label>
  );
}

function NpcMaskLayerOptions({
  layers,
}: {
  readonly layers: ReadonlyArray<MaskLayer>;
}): JSX.Element {
  if (layers.length === 0) return <option value="">No usable mask layer</option>;
  return (
    <>
      {layers.map((layer) => (
        <option key={layer.id} value={layer.id}>
          {layer.name}
        </option>
      ))}
    </>
  );
}

function NpcBinCountField(props: NpcFieldProps): JSX.Element {
  const id = useId();
  const isInvalid = props.form.binCount === null;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">Bins</span>
      <input
        id={id}
        aria-label="Bins"
        type="number"
        min={MIN_NPC_BIN_COUNT}
        step={1}
        className={cn(PANEL_NUMERIC_INPUT_CLASSES, isInvalid && INVALID_FIELD_CLASSES)}
        disabled={props.isDisabled}
        value={props.form.binsText}
        onChange={(event) => props.form.changeBinCount(event.target.value)}
      />
      {isInvalid ? <span className="text-xs text-destructive">{BIN_COUNT_HINT}</span> : null}
    </label>
  );
}

const INVALID_FIELD_CLASSES = "border-destructive focus:ring-destructive";
const BIN_COUNT_HINT = `Bins must be a whole number of at least ${MIN_NPC_BIN_COUNT}.`;

interface NpcComputeButtonProps {
  readonly isDisabled: boolean;
  readonly isComputing: boolean;
  readonly onCompute: () => void;
}

function NpcComputeButton(props: NpcComputeButtonProps): JSX.Element {
  return (
    <Button type="button" disabled={props.isDisabled} onClick={props.onCompute}>
      {props.isComputing ? "Computing..." : "Compute"}
    </Button>
  );
}

interface NpcPerBandScoresProps {
  readonly raster: RasterImage | null;
  readonly scores: ReadonlyArray<number> | null;
}

function NpcPerBandScores(props: NpcPerBandScoresProps): JSX.Element {
  return (
    <PerBandScoreSection
      scoreName={NPC_SCORE_NAME}
      raster={props.raster}
      scores={props.scores}
      formatScore={formatNpcScoreToSignificantFigures}
      notComputedText={NOT_COMPUTED_YET_TEXT}
      fixedValueRange={NPC_SCORE_PLOT_VALUE_RANGE}
    />
  );
}

const NPC_SCORE_NAME = "Potential Contrast";
const NOT_COMPUTED_YET_TEXT = "Not computed yet";
// NPC is defined on 0..1, so the plot keeps that scale rather than magnifying
// the noise between three nearly equal bands.
const NPC_SCORE_PLOT_VALUE_RANGE: SpectrumPlotValueRange = { minValue: 0, maxValue: 1 };

// The scores are stored WITH the raster they were measured on, so a stack that
// changed under the aside shows the not-computed state without an effect.
interface NpcComputedScores {
  readonly raster: RasterImage;
  readonly scores: ReadonlyArray<number>;
}

interface NpcComputeFormState {
  readonly chosenLayerId: string | null;
  readonly binsText: string;
  readonly computed: NpcComputedScores | null;
  readonly isComputing: boolean;
}

const INITIAL_NPC_COMPUTE_FORM_STATE: NpcComputeFormState = {
  chosenLayerId: null,
  binsText: String(DEFAULT_NPC_BIN_COUNT),
  computed: null,
  isComputing: false,
};

interface NpcComputeFormApi {
  readonly qualifyingLayers: ReadonlyArray<MaskLayer>;
  readonly selectedLayer: MaskLayer | null;
  readonly binsText: string;
  readonly binCount: number | null;
  readonly scores: ReadonlyArray<number> | null;
  readonly isComputing: boolean;
  readonly selectLayer: (layerId: string) => void;
  readonly changeBinCount: (binsText: string) => void;
  readonly compute: (recordScore: RecordNpcScoreCallback) => Promise<void>;
}

type RecordNpcScoreCallback = (appliedLabel: string) => void;

function useNpcComputeForm(target: NpcPanelTarget | null): NpcComputeFormApi {
  const [state, setState] = useState<NpcComputeFormState>(INITIAL_NPC_COMPUTE_FORM_STATE);
  const busyRegistrar = useBusyEntryRegistrar();
  const qualifyingLayers = listQualifyingMaskLayersForTarget(target);
  const selectedLayer = pickSelectedNpcMaskLayer(qualifyingLayers, state.chosenLayerId, target);
  const binCount = parseNpcBinCountOrNull(state.binsText);
  return {
    ...buildNpcFormReadouts(state, qualifyingLayers, selectedLayer, binCount, target),
    selectLayer: (layerId) => setState(forgetScoresAndSet({ chosenLayerId: layerId })),
    changeBinCount: (binsText) => setState(forgetScoresAndSet({ binsText })),
    compute: (recordScore) =>
      runNpcComputationForForm(
        { target, selectedLayer, binCount, busyRegistrar },
        setState,
        recordScore,
      ),
  };
}

function forgetScoresAndSet(
  change: Partial<NpcComputeFormState>,
): (previous: NpcComputeFormState) => NpcComputeFormState {
  return (previous) => ({ ...previous, ...change, computed: null });
}

function buildNpcFormReadouts(
  state: NpcComputeFormState,
  qualifyingLayers: ReadonlyArray<MaskLayer>,
  selectedLayer: MaskLayer | null,
  binCount: number | null,
  target: NpcPanelTarget | null,
): Omit<NpcComputeFormApi, "selectLayer" | "changeBinCount" | "compute"> {
  return {
    qualifyingLayers,
    selectedLayer,
    binsText: state.binsText,
    binCount,
    scores: readScoresMeasuredOnTargetOrNull(state.computed, target),
    isComputing: state.isComputing,
  };
}

function readScoresMeasuredOnTargetOrNull(
  computed: NpcComputedScores | null,
  target: NpcPanelTarget | null,
): ReadonlyArray<number> | null {
  if (computed === null || target === null) return null;
  return computed.raster === target.raster ? computed.scores : null;
}

function listQualifyingMaskLayersForTarget(
  target: NpcPanelTarget | null,
): ReadonlyArray<MaskLayer> {
  if (target === null) return EMPTY_MASK_LAYER_LIST;
  return listMaskLayersQualifyingForNpc(target.masks);
}

const EMPTY_MASK_LAYER_LIST: ReadonlyArray<MaskLayer> = Object.freeze([]);

// The picker defaults to the layer the Masks tool has selected (when it
// qualifies) and otherwise to the first usable one, so opening the panel needs
// no click in the common case. An explicit choice wins until it disappears.
function pickSelectedNpcMaskLayer(
  qualifyingLayers: ReadonlyArray<MaskLayer>,
  chosenLayerId: string | null,
  target: NpcPanelTarget | null,
): MaskLayer | null {
  return (
    findMaskLayerById(qualifyingLayers, chosenLayerId) ??
    findMaskLayerById(qualifyingLayers, target?.masks.selectedLayerId ?? null) ??
    qualifyingLayers[0] ??
    null
  );
}

function findMaskLayerById(
  layers: ReadonlyArray<MaskLayer>,
  layerId: string | null,
): MaskLayer | null {
  if (layerId === null) return null;
  return layers.find((layer) => layer.id === layerId) ?? null;
}

type NpcComputeFormStateWriter = Dispatch<SetStateAction<NpcComputeFormState>>;

interface NpcComputationInputs {
  readonly target: NpcPanelTarget | null;
  readonly selectedLayer: MaskLayer | null;
  readonly binCount: number | null;
  readonly busyRegistrar: BusyEntryRegistrar;
}

async function runNpcComputationForForm(
  inputs: NpcComputationInputs,
  setState: NpcComputeFormStateWriter,
  recordScore: RecordNpcScoreCallback,
): Promise<void> {
  const { target, selectedLayer, binCount } = inputs;
  if (target === null || selectedLayer === null || binCount === null) return;
  // The plot and list return to "Not computed yet" for the duration of the run:
  // stale scores next to a running analysis read as this run's answer.
  setState(forgetScoresAndSet({ isComputing: true }));
  try {
    const outcome = await computeNpcScoreForTarget(inputs, target, selectedLayer, binCount);
    const run = { raster: target.raster, maskLayerName: selectedLayer.name, bins: binCount };
    reportNpcOutcome(outcome, run, { setState, recordScore });
  } finally {
    setState((previous) => ({ ...previous, isComputing: false }));
  }
}

function computeNpcScoreForTarget(
  inputs: NpcComputationInputs,
  target: NpcPanelTarget,
  maskLayer: MaskLayer,
  bins: number,
): Promise<NpcAnalysisOutcome> {
  return computeNpcScoreShowingPanelBusy(
    { raster: target.raster, maskLayer, bins },
    {
      busyRegistrar: inputs.busyRegistrar,
      viewportIndex: target.viewportIndex,
      stopController: new AbortController(),
    },
  );
}

interface NpcOutcomeReporters {
  readonly setState: NpcComputeFormStateWriter;
  readonly recordScore: RecordNpcScoreCallback;
}

interface NpcCompletedRun {
  readonly raster: RasterImage;
  readonly maskLayerName: string;
  readonly bins: number;
}

function reportNpcOutcome(
  outcome: NpcAnalysisOutcome,
  run: NpcCompletedRun,
  reporters: NpcOutcomeReporters,
): void {
  if (outcome.status === "stopped") {
    toast.info(OPERATION_STOPPED_MESSAGE);
    return;
  }
  if (outcome.status === "failed") {
    notifyError(outcome.message);
    return;
  }
  reporters.setState((previous) => ({ ...previous, computed: buildComputedScores(run, outcome) }));
  recordNpcTopBandsInHistory(outcome.scores, run, reporters.recordScore);
}

function buildComputedScores(
  run: NpcCompletedRun,
  outcome: Extract<NpcAnalysisOutcome, { status: "computed" }>,
): NpcComputedScores {
  return { raster: run.raster, scores: outcome.scores };
}

// History names the same rows the panel lists, in the same order.
function recordNpcTopBandsInHistory(
  scores: ReadonlyArray<number>,
  run: NpcCompletedRun,
  recordScore: RecordNpcScoreCallback,
): void {
  const topBandRows = selectTopScoringBandRows(run.raster, scores);
  if (topBandRows.length === 0) return;
  recordScore(formatNpcHistoryAppliedLabel(run.maskLayerName, run.bins, topBandRows));
}
