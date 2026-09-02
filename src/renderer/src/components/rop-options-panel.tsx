import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { PANEL_SELECT_CLASSES } from "@/components/form-control-classes";
import { RopSearchSection } from "@/components/rop-search-section";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROP_PANEL_ICON } from "@/lib/actions/operation-command-bindings";
import { ROP_KEPT_SUCCESS_MESSAGE, type RopKeepRequest } from "@/lib/actions/rop-keep-action";
import {
  canRopRunDeliverSomewhere,
  ROP_PRESS_NEEDS_A_FREE_PANEL_MESSAGE,
  type RopCandidateDeliveryPort,
  type RopLiveCandidatePanel,
} from "@/lib/analysis/rop-candidate-delivery";
import {
  canKeepTheCandidateOnScreen,
  planRopKeep,
  type RopKeepIntent,
  type RopKeepPlan,
  type RopKeepSituation,
} from "@/lib/analysis/rop-keep-plan";
import {
  deriveCnrCategoryDefaultsOrNull,
  describeRopObjectiveForHistory,
  findQualifyingRopMaskLayerOrNull,
  isRopObjectiveKindAvailable,
  ROP_OBJECTIVES_NEED_TWO_PAINTED_CATEGORIES,
  type RopCustomObjectiveScript,
  type RopObjectiveKind,
} from "@/lib/analysis/rop-objective";
import {
  dropScoresAfterObjectiveChange,
  retainBestScoringRopCandidate,
  type RopCandidate,
} from "@/lib/analysis/rop-candidate";
import { formatRopScoreToSignificantFigures } from "@/lib/analysis/rop-format";
import {
  drawRopSeed,
  readForcedRopSeedFromE2eBridgeOrNull,
} from "@/lib/analysis/rop-run-request";
import { listNonEmptyCategoryValuesInMaskLayer } from "@/lib/analysis/npc-qualification";
import { DEFAULT_NPC_BIN_COUNT } from "@/lib/analysis/npc-run-request";
import {
  DEFAULT_ROP_SEARCH_PROJECTION_COUNT,
  parseRopSearchProjectionCountOrNull,
  type RopSearchRunRequest,
} from "@/lib/analysis/rop-search-request";
import { searchBestRopProjectionShowingPanelBusy } from "@/lib/analysis/run-rop-search";
import {
  createRopProjectionSessionHolder,
  scoreRopCandidateShowingPanelBusy,
  type RopProjectionSessionHolder,
  type RopRollOutcome,
} from "@/lib/analysis/run-rop-analysis";
import { OPERATION_STOPPED_MESSAGE } from "@/lib/image/operation-stop";
import type { RasterImage } from "@/lib/image/raster-image";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";
import { notifyError, notifySuccess } from "@/lib/notifications/notify";
import { useBusyEntryRegistrar, type BusyEntryRegistrar } from "@/state/busy-state-context";

// CT-309: the ROP aside. Every "New projection" press draws a fresh seed and
// re-executes the built-in rop.py against the session-retained cube. With an
// objective selected, each candidate is scored and the best-scoring one since
// the panel opened is retained; the panel never holds more than the current
// and best candidates.
//
// CT-316: a press delivers its candidate as a REAL one-band stack in a
// candidate panel next to the source (the source panel itself is never
// touched); the next press replaces that panel's content in place. The aside
// remembers the candidate panel by raster identity and never overwrites a
// panel the user closed or changed.
//
// CT-317: Keep FREEZES that panel instead of copying it - the aside drops its
// pointer, so the panel becomes an ordinary stack and the next press opens a
// fresh one. Keep best freezes too when the best IS the candidate on screen,
// and otherwise copies the best into the lowest free panel; a search winner
// arrives frozen either in the candidate panel or in the lowest free one.
// rop-keep-plan.ts holds that decision table.

export interface RopPanelTarget {
  readonly viewportIndex: number;
  readonly viewportNumber: number;
  readonly raster: RasterImage;
  readonly masks: MaskPanelState;
}

export interface RopOptionsPanelProps {
  readonly target: RopPanelTarget | null;
  readonly candidateDelivery: RopCandidateDeliveryPort;
  readonly onKeepCandidateAsNewStack: (request: RopKeepRequest) => void;
  readonly onClose: () => void;
}

export function RopOptionsPanel(props: RopOptionsPanelProps): JSX.Element {
  return (
    <aside aria-label="ROP options" className={ROP_PANEL_CLASSES}>
      <RopPanelHeader
        viewportNumber={props.target?.viewportNumber ?? null}
        onClose={props.onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <RopPanelBody
          target={props.target}
          candidateDelivery={props.candidateDelivery}
          onKeepCandidateAsNewStack={props.onKeepCandidateAsNewStack}
        />
      </div>
    </aside>
  );
}

const ROP_PANEL_CLASSES = "flex w-[300px] shrink-0 flex-col border-l bg-card";

interface RopPanelHeaderProps {
  readonly viewportNumber: number | null;
  readonly onClose: () => void;
}

function RopPanelHeader(props: RopPanelHeaderProps): JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ROP_PANEL_ICON className="size-4" aria-hidden="true" />
        ROP
      </span>
      <div className="flex items-center gap-2">
        {props.viewportNumber === null ? null : (
          <span className="text-xs text-muted-foreground">Panel {props.viewportNumber}</span>
        )}
        <RopPanelCloseButton onClose={props.onClose} />
      </div>
    </div>
  );
}

function RopPanelCloseButton({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Close ROP options" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Close ROP options</TooltipContent>
    </Tooltip>
  );
}

interface RopPanelBodyProps {
  readonly target: RopPanelTarget | null;
  readonly candidateDelivery: RopCandidateDeliveryPort;
  readonly onKeepCandidateAsNewStack: (request: RopKeepRequest) => void;
}

function RopPanelBody(props: RopPanelBodyProps): JSX.Element {
  const controller = useRopPanelController(props);
  return (
    <>
      <RopExplanation />
      <RopObjectiveSection controller={controller} />
      <RopNewProjectionButton controller={controller} />
      <RopCandidateReadout controller={controller} />
      <RopBestCandidateReadout controller={controller} />
      <RopSearchSection
        projectionCountText={controller.projectionCountText}
        onChangeProjectionCountText={controller.changeProjectionCountText}
        isObjectiveChosen={controller.isObjectiveChosen}
        canSearchNow={controller.canSearchNow}
        isSearching={controller.isSearching}
        onSearch={() => void controller.runProjectionSearch()}
        deliveryRefusesEveryPanel={controller.deliveryRefusesEveryPanel}
      />
    </>
  );
}

function RopExplanation(): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      Each press of New projection opens a fresh random orthogonal projection of
      this stack as a one-band stack in its own panel; the next press replaces
      it. Keep freezes the one on screen so it is not replaced; with an
      objective selected the best-scoring candidate is always retained.
    </p>
  );
}

// --- Objective controls ------------------------------------------------------

interface RopControllerProps {
  readonly controller: RopPanelController;
}

const OBJECTIVE_LABELS: Record<RopObjectiveKind, string> = {
  none: "None",
  npc: "NPC",
  cnr: "CNR",
  custom: "Custom script",
};

function RopObjectiveSection({ controller }: RopControllerProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <RopObjectivePicker controller={controller} />
      {controller.maskObjectivesAvailable ? null : (
        <p className="text-xs text-muted-foreground">
          {ROP_OBJECTIVES_NEED_TWO_PAINTED_CATEGORIES}
        </p>
      )}
      {controller.objectiveKind === "cnr" ? <RopCnrCategoryPickers controller={controller} /> : null}
      {controller.objectiveKind === "custom" ? <RopCustomScriptControls controller={controller} /> : null}
    </div>
  );
}

function RopObjectivePicker({ controller }: RopControllerProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">Objective</span>
      <select
        id={id}
        aria-label="Objective"
        className={PANEL_SELECT_CLASSES}
        value={controller.objectiveKind}
        onChange={(event) => controller.chooseObjective(event.target.value as RopObjectiveKind)}
      >
        <RopObjectiveOptions controller={controller} />
      </select>
    </label>
  );
}

function RopObjectiveOptions({ controller }: RopControllerProps): JSX.Element {
  return (
    <>
      {(Object.keys(OBJECTIVE_LABELS) as RopObjectiveKind[]).map((kind) => (
        <option key={kind} value={kind} disabled={!controller.isObjectiveAvailable(kind)}>
          {OBJECTIVE_LABELS[kind]}
        </option>
      ))}
    </>
  );
}

function RopCnrCategoryPickers({ controller }: RopControllerProps): JSX.Element {
  return (
    <>
      <RopCnrCategoryPicker
        label="Text category"
        value={controller.cnrTextCategoryValue}
        onChoose={controller.chooseCnrTextCategory}
        layer={controller.qualifyingLayer}
      />
      <RopCnrCategoryPicker
        label="Background category"
        value={controller.cnrBackgroundCategoryValue}
        onChoose={controller.chooseCnrBackgroundCategory}
        layer={controller.qualifyingLayer}
      />
    </>
  );
}

interface RopCnrCategoryPickerProps {
  readonly label: string;
  readonly value: number | null;
  readonly onChoose: (categoryValue: number) => void;
  readonly layer: MaskLayer | null;
}

function RopCnrCategoryPicker(props: RopCnrCategoryPickerProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.label}</span>
      <select
        id={id}
        aria-label={props.label}
        className={PANEL_SELECT_CLASSES}
        value={props.value ?? ""}
        onChange={(event) => props.onChoose(Number(event.target.value))}
      >
        <RopCnrCategoryOptions layer={props.layer} />
      </select>
    </label>
  );
}

function RopCnrCategoryOptions({ layer }: { readonly layer: MaskLayer | null }): JSX.Element {
  if (layer === null) return <option value="">No usable mask layer</option>;
  return (
    <>
      {listNonEmptyCategoryValuesInMaskLayer(layer).map((categoryValue) => (
        <option key={categoryValue} value={categoryValue}>
          {layer.categories[categoryValue - 1]?.name ?? `Category ${categoryValue}`}
        </option>
      ))}
    </>
  );
}

function RopCustomScriptControls({ controller }: RopControllerProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" onClick={() => void controller.importObjectiveScript()}>
        Import script...
      </Button>
      <p className="text-xs font-medium text-foreground">
        {controller.customScript
          ? `Objective loaded: ${controller.customScript.fileName}.`
          : "No objective script set. Import a tool."}
      </p>
    </div>
  );
}

// --- Candidate readouts ------------------------------------------------------

function RopNewProjectionButton({ controller }: RopControllerProps): JSX.Element {
  return (
    <Button
      type="button"
      disabled={!controller.canRollNow}
      onClick={() => void controller.rollNewProjection()}
    >
      {controller.isRolling ? "Projecting..." : "New projection"}
    </Button>
  );
}

function RopCandidateReadout({ controller }: RopControllerProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Current candidate</span>
      <output aria-label="ROP seed" className="font-mono text-sm text-foreground">
        {controller.current === null ? NO_CANDIDATE_YET_TEXT : `Seed ${controller.current.seed}`}
      </output>
      {controller.objectiveKind === "none" ? null : (
        <RopScoreLine ariaLabel="ROP score" score={controller.current?.score ?? null} />
      )}
      <Button
        type="button"
        variant="outline"
        disabled={!controller.canKeepTheCandidateOnScreen || controller.isRolling}
        onClick={() => void controller.keepTheCandidateOnScreen()}
      >
        Keep
      </Button>
    </div>
  );
}

function RopBestCandidateReadout({ controller }: RopControllerProps): JSX.Element {
  if (controller.best === null) return <></>;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        Best so far (seed {controller.best.seed})
      </span>
      <RopScoreLine ariaLabel="Best ROP score" score={controller.best.score} />
      <Button
        type="button"
        variant="outline"
        disabled={controller.isRolling}
        onClick={() => void controller.keepTheBestCandidate()}
      >
        Keep best
      </Button>
    </div>
  );
}

function RopScoreLine({
  ariaLabel,
  score,
}: {
  readonly ariaLabel: string;
  readonly score: number | null;
}): JSX.Element {
  return (
    <output aria-label={ariaLabel} className="font-mono text-sm text-foreground">
      {score === null ? NOT_SCORED_TEXT : formatRopScoreToSignificantFigures(score)}
    </output>
  );
}

const NO_CANDIDATE_YET_TEXT = "No projection yet";
const NOT_SCORED_TEXT = "Not scored";

// --- Controller --------------------------------------------------------------

interface RopPanelState {
  readonly current: RopCandidate | null;
  readonly best: RopCandidate | null;
  // CT-316: the panel holding the last delivered candidate, recognised by
  // raster identity before every press; null once it was closed or changed.
  readonly liveCandidatePanel: RopLiveCandidatePanel | null;
  readonly isRolling: boolean;
  readonly isSearching: boolean;
  readonly projectionCountText: string;
  readonly objectiveKind: RopObjectiveKind;
  readonly chosenCnrText: number | null;
  readonly chosenCnrBackground: number | null;
  readonly customScript: RopCustomObjectiveScript | null;
}

const INITIAL_ROP_PANEL_STATE: RopPanelState = {
  current: null,
  best: null,
  liveCandidatePanel: null,
  isRolling: false,
  isSearching: false,
  projectionCountText: String(DEFAULT_ROP_SEARCH_PROJECTION_COUNT),
  objectiveKind: "none",
  chosenCnrText: null,
  chosenCnrBackground: null,
  customScript: null,
};

interface RopPanelController {
  readonly current: RopCandidate | null;
  readonly best: RopCandidate | null;
  readonly isRolling: boolean;
  readonly isSearching: boolean;
  readonly projectionCountText: string;
  readonly isObjectiveChosen: boolean;
  readonly canSearchNow: boolean;
  readonly deliveryRefusesEveryPanel: boolean;
  readonly changeProjectionCountText: (text: string) => void;
  readonly runProjectionSearch: () => Promise<void>;
  readonly objectiveKind: RopObjectiveKind;
  readonly qualifyingLayer: MaskLayer | null;
  readonly maskObjectivesAvailable: boolean;
  readonly cnrTextCategoryValue: number | null;
  readonly cnrBackgroundCategoryValue: number | null;
  readonly customScript: RopCustomObjectiveScript | null;
  readonly canRollNow: boolean;
  readonly canKeepTheCandidateOnScreen: boolean;
  readonly isObjectiveAvailable: (kind: RopObjectiveKind) => boolean;
  readonly keepTheCandidateOnScreen: () => Promise<void>;
  readonly keepTheBestCandidate: () => Promise<void>;
  readonly chooseObjective: (kind: RopObjectiveKind) => void;
  readonly chooseCnrTextCategory: (categoryValue: number) => void;
  readonly chooseCnrBackgroundCategory: (categoryValue: number) => void;
  readonly importObjectiveScript: () => Promise<void>;
  readonly rollNewProjection: () => Promise<void>;
}

function useRopPanelController(props: RopPanelBodyProps): RopPanelController {
  const { target, onKeepCandidateAsNewStack: keepAsNewStack } = props;
  const [state, setState] = useState<RopPanelState>(INITIAL_ROP_PANEL_STATE);
  const busyRegistrar = useBusyEntryRegistrar();
  const sessionRef = useRopSessionHolderResetOnRasterChange(target, setState);
  const deliveryRef = useLatestCandidateDeliveryPort(props.candidateDelivery);
  const derived = deriveRopControllerReadouts(state, target, props.candidateDelivery);
  const press: RopPress = { target, derived, sessionRef, busyRegistrar, setState, deliveryRef };
  const keep: RopKeepRun = { target, derived, state, setState, deliveryRef, keepAsNewStack };
  return {
    ...derived,
    ...buildRopObjectiveChoiceHandlers(setState),
    changeProjectionCountText: (text) =>
      setState((previous) => ({ ...previous, projectionCountText: text })),
    rollNewProjection: () => rollNewRopProjection(press, state.liveCandidatePanel),
    keepTheCandidateOnScreen: () => carryOutRopKeep("keep-current", keep),
    keepTheBestCandidate: () => carryOutRopKeep("keep-best", keep),
    runProjectionSearch: () =>
      runRopProjectionSearch({ target, derived, sessionRef, busyRegistrar, setState, keep }),
  };
}

type RopPanelStateWriter = React.Dispatch<React.SetStateAction<RopPanelState>>;

type RopCandidateDeliveryPortRef = React.MutableRefObject<RopCandidateDeliveryPort>;

// The delivery happens AFTER the asynchronous projection run, so it must read
// the port App built on the latest render (the panel map may have changed
// while the Python worker ran), not the one captured at click time.
function useLatestCandidateDeliveryPort(
  port: RopCandidateDeliveryPort,
): RopCandidateDeliveryPortRef {
  const ref = useRef(port);
  ref.current = port;
  return ref;
}

interface RopSessionSlot {
  raster: RasterImage;
  holder: RopProjectionSessionHolder;
}

// The retained session spools the SOURCE cube; a different raster identity
// (an in-place apply, a changed selection) invalidates both the session and
// any candidates projected from the old cube.
function useRopSessionHolderResetOnRasterChange(
  target: RopPanelTarget | null,
  setState: RopPanelStateWriter,
): React.MutableRefObject<RopSessionSlot | null> {
  const sessionRef = useRef<RopSessionSlot | null>(null);
  const raster = target?.raster ?? null;
  useEffect(() => {
    return () => {
      releaseRopSessionSlot(sessionRef);
      setState(INITIAL_ROP_PANEL_STATE);
    };
  }, [raster, setState]);
  return sessionRef;
}

function releaseRopSessionSlot(sessionRef: React.MutableRefObject<RopSessionSlot | null>): void {
  const slot = sessionRef.current;
  sessionRef.current = null;
  if (slot !== null) void slot.holder.release();
}

interface RopControllerReadouts {
  readonly current: RopCandidate | null;
  readonly best: RopCandidate | null;
  readonly isRolling: boolean;
  readonly isSearching: boolean;
  readonly projectionCountText: string;
  readonly isObjectiveChosen: boolean;
  readonly canSearchNow: boolean;
  readonly deliveryRefusesEveryPanel: boolean;
  readonly objectiveKind: RopObjectiveKind;
  readonly qualifyingLayer: MaskLayer | null;
  readonly maskObjectivesAvailable: boolean;
  readonly cnrTextCategoryValue: number | null;
  readonly cnrBackgroundCategoryValue: number | null;
  readonly customScript: RopCustomObjectiveScript | null;
  readonly canRollNow: boolean;
  // CT-317: null once the candidate panel was kept, closed, or changed, which
  // is exactly when Keep has nothing left to freeze.
  readonly liveCandidatePanelIndex: number | null;
  readonly canKeepTheCandidateOnScreen: boolean;
  readonly isObjectiveAvailable: (kind: RopObjectiveKind) => boolean;
}

function deriveRopControllerReadouts(
  state: RopPanelState,
  target: RopPanelTarget | null,
  candidateDelivery: RopCandidateDeliveryPort,
): RopControllerReadouts {
  const qualifyingLayer = target ? findQualifyingRopMaskLayerOrNull(target.masks) : null;
  const objectiveKind = clampObjectiveKindToAvailability(state.objectiveKind, qualifyingLayer);
  const cnrChoice = resolveCnrCategoryChoice(state, qualifyingLayer);
  const canRollNow = canRollNewProjectionNow(state, target, objectiveKind, cnrChoice);
  const keepReadouts = deriveRopKeepReadouts(state, candidateDelivery);
  const canDeliverSomewhere = canRopRunDeliverSomewhere(
    keepReadouts.liveCandidatePanelIndex,
    candidateDelivery.canOpenFreshCandidatePanel(),
  );
  return {
    ...keepReadouts,
    current: state.current,
    best: state.best,
    isRolling: state.isRolling,
    isSearching: state.isSearching,
    projectionCountText: state.projectionCountText,
    objectiveKind,
    qualifyingLayer,
    maskObjectivesAvailable: qualifyingLayer !== null,
    ...cnrChoice,
    customScript: state.customScript,
    canRollNow,
    isObjectiveChosen: objectiveKind !== "none",
    // CT-330: the delivery pre-check is asked separately (deliveryRefusesEveryPanel)
    // so the Search button's disabled+tooltip state can explain WHY, and the click
    // handler still runs its own copy of the same check (checkRopRunCanDeliverSomewhere)
    // rather than silently no-opping when this flag alone would gate it.
    canSearchNow: canRollNow && objectiveKind !== "none" && hasUsableProjectionCount(state),
    deliveryRefusesEveryPanel: !canDeliverSomewhere,
    isObjectiveAvailable: (kind) =>
      target !== null && isRopObjectiveKindAvailable(kind, target.masks),
  };
}

// The pointer is re-resolved against the LATEST panel map on every render, so
// closing or changing the candidate panel disables Keep with no effect needed.
function deriveRopKeepReadouts(
  state: RopPanelState,
  candidateDelivery: RopCandidateDeliveryPort,
): Pick<RopControllerReadouts, "liveCandidatePanelIndex" | "canKeepTheCandidateOnScreen"> {
  const liveCandidatePanelIndex = candidateDelivery.resolveReplaceIndexOrNull(
    state.liveCandidatePanel,
  );
  return {
    liveCandidatePanelIndex,
    canKeepTheCandidateOnScreen: canKeepTheCandidateOnScreen(
      describeRopKeepSituation(state, liveCandidatePanelIndex),
    ),
  };
}

function clampObjectiveKindToAvailability(
  kind: RopObjectiveKind,
  qualifyingLayer: MaskLayer | null,
): RopObjectiveKind {
  if ((kind === "npc" || kind === "cnr") && qualifyingLayer === null) return "none";
  return kind;
}

interface CnrCategoryChoice {
  readonly cnrTextCategoryValue: number | null;
  readonly cnrBackgroundCategoryValue: number | null;
}

// An explicit picker choice wins while its category still has painted pixels;
// otherwise the locked defaults (categories 1 and 2, falling back to the first
// non-empty ones) apply.
function resolveCnrCategoryChoice(
  state: RopPanelState,
  qualifyingLayer: MaskLayer | null,
): CnrCategoryChoice {
  const defaults = deriveCnrCategoryDefaultsOrNull(qualifyingLayer);
  if (defaults === null) return { cnrTextCategoryValue: null, cnrBackgroundCategoryValue: null };
  const nonEmpty = qualifyingLayer ? listNonEmptyCategoryValuesInMaskLayer(qualifyingLayer) : [];
  return {
    cnrTextCategoryValue: pickChosenCategoryOrDefault(state.chosenCnrText, nonEmpty, defaults.textCategoryValue),
    cnrBackgroundCategoryValue: pickChosenCategoryOrDefault(state.chosenCnrBackground, nonEmpty, defaults.backgroundCategoryValue),
  };
}

function pickChosenCategoryOrDefault(
  chosen: number | null,
  nonEmptyCategoryValues: ReadonlyArray<number>,
  defaultValue: number,
): number {
  if (chosen !== null && nonEmptyCategoryValues.includes(chosen)) return chosen;
  return defaultValue;
}

function canRollNewProjectionNow(
  state: RopPanelState,
  target: RopPanelTarget | null,
  objectiveKind: RopObjectiveKind,
  cnrChoice: CnrCategoryChoice,
): boolean {
  if (target === null || state.isRolling || state.isSearching) return false;
  if (objectiveKind === "custom" && state.customScript === null) return false;
  if (objectiveKind === "cnr") return canScoreCnrWithChoice(cnrChoice);
  return true;
}

function hasUsableProjectionCount(state: RopPanelState): boolean {
  return parseRopSearchProjectionCountOrNull(state.projectionCountText) !== null;
}

function canScoreCnrWithChoice(choice: CnrCategoryChoice): boolean {
  return (
    choice.cnrTextCategoryValue !== null &&
    choice.cnrBackgroundCategoryValue !== null &&
    choice.cnrTextCategoryValue !== choice.cnrBackgroundCategoryValue
  );
}

function buildRopObjectiveChoiceHandlers(setState: RopPanelStateWriter) {
  return {
    chooseObjective: (kind: RopObjectiveKind) =>
      setState((previous) => resetScoresForNewObjective(previous, kind)),
    chooseCnrTextCategory: (categoryValue: number) =>
      setState((previous) => resetScoresForNewObjective({ ...previous, chosenCnrText: categoryValue }, previous.objectiveKind)),
    chooseCnrBackgroundCategory: (categoryValue: number) =>
      setState((previous) => resetScoresForNewObjective({ ...previous, chosenCnrBackground: categoryValue }, previous.objectiveKind)),
    importObjectiveScript: () => importRopObjectiveScript(setState),
  };
}

// Changing what "score" means makes earlier scores incomparable, so the best
// resets and the on-screen candidate keeps its stack but drops its score.
function resetScoresForNewObjective(
  previous: RopPanelState,
  kind: RopObjectiveKind,
): RopPanelState {
  return {
    ...previous,
    objectiveKind: kind,
    best: null,
    current: dropScoresAfterObjectiveChange(previous.current),
  };
}

// CT-310: the source is read at import, not at run time, because the search
// sends it as a run parameter and scores every candidate with it. A file whose
// source cannot be read (a .zip tool) is refused here rather than half-set: a
// press and a search must always score with the same objective code.
async function importRopObjectiveScript(setState: RopPanelStateWriter): Promise<void> {
  try {
    const picked = await window.toolboxApi.pickUserScriptFile();
    if (picked.canceled) return;
    const read = await window.toolboxApi.readUserScriptSource(picked.filePath);
    if (read.status !== "read") {
      notifyError(read.message);
      return;
    }
    setState((previous) => rememberImportedObjectiveScript(previous, picked, read.source));
  } catch (error) {
    notifyError(error instanceof Error ? error.message : String(error));
  }
}

function rememberImportedObjectiveScript(
  previous: RopPanelState,
  picked: { readonly filePath: string; readonly fileName: string },
  source: string,
): RopPanelState {
  const customScript = { filePath: picked.filePath, fileName: picked.fileName, source };
  return resetScoresForNewObjective({ ...previous, customScript }, previous.objectiveKind);
}

// --- The press ---------------------------------------------------------------

interface RopPress {
  readonly target: RopPanelTarget | null;
  readonly derived: RopControllerReadouts;
  readonly sessionRef: React.MutableRefObject<RopSessionSlot | null>;
  readonly busyRegistrar: BusyEntryRegistrar;
  readonly setState: RopPanelStateWriter;
  readonly deliveryRef: RopCandidateDeliveryPortRef;
}

// CT-330: shared by a press and a search, both of which must refuse BEFORE
// running rather than discover after a long run that the winner has nowhere
// to land. Resolves the panel a delivery would replace, or refuses (toasting
// and dropping the stale live-candidate pointer) when neither replacing nor
// opening a fresh panel is possible.
type RopRunDeliveryCheck =
  | { readonly status: "ok"; readonly replaceAtIndex: number | null }
  | { readonly status: "refused" };

function checkRopRunCanDeliverSomewhere(
  deliveryRef: RopCandidateDeliveryPortRef,
  liveCandidatePanel: RopLiveCandidatePanel | null,
  setState: RopPanelStateWriter,
): RopRunDeliveryCheck {
  const replaceAtIndex = deliveryRef.current.resolveReplaceIndexOrNull(liveCandidatePanel);
  if (canRopRunDeliverSomewhere(replaceAtIndex, deliveryRef.current.canOpenFreshCandidatePanel())) {
    return { status: "ok", replaceAtIndex };
  }
  notifyError(ROP_PRESS_NEEDS_A_FREE_PANEL_MESSAGE);
  setState((previous) => ({ ...previous, liveCandidatePanel: null }));
  return { status: "refused" };
}

// A press that cannot land anywhere is refused BEFORE the projection runs:
// with a live candidate panel it replaces that panel, otherwise it needs a
// free panel or a larger layout.
async function rollNewRopProjection(
  press: RopPress,
  liveCandidatePanel: RopLiveCandidatePanel | null,
): Promise<void> {
  if (press.target === null || !press.derived.canRollNow) return;
  const check = checkRopRunCanDeliverSomewhere(press.deliveryRef, liveCandidatePanel, press.setState);
  if (check.status === "refused") return;
  press.setState((previous) => ({ ...previous, isRolling: true }));
  try {
    await rollScoreAndDeliverOneCandidate(press, press.target, check.replaceAtIndex);
  } finally {
    press.setState((previous) => ({ ...previous, isRolling: false }));
  }
}

async function rollScoreAndDeliverOneCandidate(
  press: RopPress,
  target: RopPanelTarget,
  replaceAtIndex: number | null,
): Promise<void> {
  const seed = drawRopSeed(readForcedRopSeedFromE2eBridgeOrNull());
  const rolled = await executeProjectionForSeed(press, target, seed);
  if (rolled.status !== "rolled") {
    reportRollProblem(rolled);
    return;
  }
  const score = await scoreRolledCandidateOrNull(rolled.values, target, press.derived, press.busyRegistrar);
  const candidate = commitRolledCandidate(seed, rolled.values, score, press.setState);
  await deliverCandidateToItsPanel(press, target, candidate, replaceAtIndex);
}

function executeProjectionForSeed(
  press: RopPress,
  target: RopPanelTarget,
  seed: number,
): Promise<RopRollOutcome> {
  const holder = takeOrCreateSessionHolderForRaster(press.sessionRef, target.raster);
  return holder.executeProjectionShowingPanelBusy(seed, {
    busyRegistrar: press.busyRegistrar,
    viewportIndex: target.viewportIndex,
    stopController: new AbortController(),
  });
}

// The delivered panel (or null when nothing landed) becomes the live candidate
// panel the next press replaces.
async function deliverCandidateToItsPanel(
  press: RopPress,
  target: RopPanelTarget,
  candidate: RopCandidate,
  replaceAtIndex: number | null,
): Promise<void> {
  const request = buildRopKeepRequestOrNull(candidate, target, press.derived);
  if (request === null) return;
  const delivered = await press.deliveryRef.current.deliverCandidate(request, replaceAtIndex);
  press.setState((previous) => ({ ...previous, liveCandidatePanel: delivered }));
}

function takeOrCreateSessionHolderForRaster(
  sessionRef: React.MutableRefObject<RopSessionSlot | null>,
  raster: RasterImage,
): RopProjectionSessionHolder {
  if (sessionRef.current !== null && sessionRef.current.raster === raster) {
    return sessionRef.current.holder;
  }
  releaseRopSessionSlot(sessionRef);
  const holder = createRopProjectionSessionHolder(raster);
  sessionRef.current = { raster, holder };
  return holder;
}

function reportRollProblem(rolled: Exclude<RopRollOutcome, { status: "rolled" }>): void {
  if (rolled.status === "stopped") {
    toast.info(OPERATION_STOPPED_MESSAGE);
    return;
  }
  notifyError(rolled.message);
}

// A stopped or failed scoring run keeps the candidate (its stack is still
// delivered) but leaves it unscored, so it can never displace the retained best.
async function scoreRolledCandidateOrNull(
  values: Float32Array,
  target: RopPanelTarget,
  derived: RopControllerReadouts,
  busyRegistrar: BusyEntryRegistrar,
): Promise<number | null> {
  if (derived.objectiveKind === "none") return null;
  const outcome = await scoreRopCandidateShowingPanelBusy(
    {
      candidateValues: values,
      width: target.raster.width,
      height: target.raster.height,
      objectiveKind: derived.objectiveKind,
      maskLayer: derived.qualifyingLayer,
      cnrTextCategoryValue: derived.cnrTextCategoryValue,
      cnrBackgroundCategoryValue: derived.cnrBackgroundCategoryValue,
      customScript: derived.customScript,
    },
    { busyRegistrar, viewportIndex: target.viewportIndex, stopController: new AbortController() },
  );
  return reportScoreOutcome(outcome);
}

function reportScoreOutcome(
  outcome: Awaited<ReturnType<typeof scoreRopCandidateShowingPanelBusy>>,
): number | null {
  if (outcome.status === "scored") return outcome.score;
  if (outcome.status === "stopped") toast.info(OPERATION_STOPPED_MESSAGE);
  else notifyError(outcome.message);
  return null;
}

function commitRolledCandidate(
  seed: number,
  values: Float32Array,
  score: number | null,
  setState: RopPanelStateWriter,
): RopCandidate {
  const candidate: RopCandidate = { seed, values, score };
  setState((previous) => ({
    ...previous,
    current: candidate,
    best: retainBestScoringRopCandidate(previous.best, candidate),
  }));
  return candidate;
}

function buildRopKeepRequestOrNull(
  candidate: RopCandidate | null,
  target: RopPanelTarget | null,
  derived: RopControllerReadouts,
): RopKeepRequest | null {
  if (candidate === null || target === null) return null;
  return {
    seed: candidate.seed,
    values: candidate.values,
    width: target.raster.width,
    height: target.raster.height,
    score: candidate.score,
    searchedProjectionCount: candidate.searchedProjectionCount ?? null,
    objectiveLabel:
      candidate.score === null
        ? null
        : describeRopObjectiveForHistory(derived.objectiveKind, derived.customScript),
  };
}

// --- Keep --------------------------------------------------------------------

interface RopKeepRun {
  readonly target: RopPanelTarget | null;
  readonly derived: RopControllerReadouts;
  readonly state: RopPanelState;
  readonly setState: RopPanelStateWriter;
  readonly deliveryRef: RopCandidateDeliveryPortRef;
  readonly keepAsNewStack: (request: RopKeepRequest) => void;
}

function describeRopKeepSituation(
  state: RopPanelState,
  liveCandidatePanelIndex: number | null,
): RopKeepSituation {
  return {
    liveCandidatePanelIndex,
    bestIsTheLiveCandidate: state.best !== null && state.best === state.current,
  };
}

// The live candidate panel shows whatever the last press committed as
// `current`, so "the best IS the candidate on screen" is that identity.
function carryOutRopKeep(intent: RopKeepIntent, keep: RopKeepRun): Promise<void> {
  const candidate = intent === "keep-current" ? keep.state.current : keep.state.best;
  const request = buildRopKeepRequestOrNull(candidate, keep.target, keep.derived);
  if (request === null) return Promise.resolve();
  const situation = describeRopKeepSituation(keep.state, keep.derived.liveCandidatePanelIndex);
  return carryOutRopKeepPlan(planRopKeep(intent, situation), request, keep);
}

async function carryOutRopKeepPlan(
  plan: RopKeepPlan,
  request: RopKeepRequest,
  keep: RopKeepRun,
): Promise<void> {
  if (plan.kind === "disabled") return;
  if (plan.kind === "deliverAsNewFrozenStack") {
    keep.keepAsNewStack(request);
    return;
  }
  if (plan.kind === "replaceLiveCandidatePanelWithFrozenStack") {
    await keep.deliveryRef.current.deliverCandidate(request, plan.viewportIndex, "frozen");
  } else {
    notifySuccess(ROP_KEPT_SUCCESS_MESSAGE);
  }
  dropTheLiveCandidatePanelPointer(keep.setState);
}

// Freezing costs nothing: the stack is already in its panel, so forgetting
// where it is makes it an ordinary panel the next press will not replace.
function dropTheLiveCandidatePanelPointer(setState: RopPanelStateWriter): void {
  setState((previous) => ({ ...previous, liveCandidatePanel: null }));
}

// --- The search ---------------------------------------------------------------

interface RopSearchRun {
  readonly target: RopPanelTarget | null;
  readonly derived: RopControllerReadouts;
  readonly sessionRef: React.MutableRefObject<RopSessionSlot | null>;
  readonly busyRegistrar: BusyEntryRegistrar;
  readonly setState: RopPanelStateWriter;
  // CT-317: the winner is delivered FROZEN through the same decision table the
  // Keep buttons use, so it lands in the candidate panel when one is live.
  readonly keep: RopKeepRun;
}

async function runRopProjectionSearch(run: RopSearchRun): Promise<void> {
  const request = buildRopSearchRunRequestOrNull(run.target, run.derived);
  if (run.target === null || request === null || !run.derived.canSearchNow) return;
  const check = checkRopRunCanDeliverSomewhere(run.keep.deliveryRef, run.keep.state.liveCandidatePanel, run.setState);
  if (check.status === "refused") return;
  run.setState((previous) => ({ ...previous, isSearching: true }));
  // The press session's retained spool holds a whole copy of the cube and a
  // search is long: dropping it keeps one cube on disk instead of two, at the
  // cost of re-uploading on the next press.
  releaseRopSessionSlot(run.sessionRef);
  try {
    await searchAndDeliverBestProjection(run, run.target, request);
  } finally {
    run.setState((previous) => ({ ...previous, isSearching: false }));
  }
}

function buildRopSearchRunRequestOrNull(
  target: RopPanelTarget | null,
  derived: RopControllerReadouts,
): RopSearchRunRequest | null {
  const projectionCount = parseRopSearchProjectionCountOrNull(derived.projectionCountText);
  if (target === null || projectionCount === null || derived.objectiveKind === "none") return null;
  return {
    seed: drawRopSeed(readForcedRopSeedFromE2eBridgeOrNull()),
    projectionCount,
    objectiveKind: derived.objectiveKind,
    maskLayer: derived.qualifyingLayer,
    npcBinCount: DEFAULT_NPC_BIN_COUNT,
    cnrTextCategoryValue: derived.cnrTextCategoryValue,
    cnrBackgroundCategoryValue: derived.cnrBackgroundCategoryValue,
    customObjectiveSource: derived.customScript?.source ?? null,
  };
}

async function searchAndDeliverBestProjection(
  run: RopSearchRun,
  target: RopPanelTarget,
  request: RopSearchRunRequest,
): Promise<void> {
  const outcome = await searchBestRopProjectionShowingPanelBusy(request, target.raster, {
    busyRegistrar: run.busyRegistrar,
    viewportIndex: target.viewportIndex,
    stopController: new AbortController(),
  });
  if (outcome.status !== "searched") {
    reportRollProblem(outcome);
    return;
  }
  await scoreAndDeliverSearchWinner(run, target, request, outcome.values);
}

// The winner is scored the same way a press is, so the number History records
// is measured on the stack that was actually delivered.
async function scoreAndDeliverSearchWinner(
  run: RopSearchRun,
  target: RopPanelTarget,
  request: RopSearchRunRequest,
  values: Float32Array,
): Promise<void> {
  const score = await scoreRolledCandidateOrNull(values, target, run.derived, run.busyRegistrar);
  const winner: RopCandidate = {
    seed: request.seed,
    values,
    score,
    searchedProjectionCount: request.projectionCount,
  };
  commitSearchWinner(winner, run.setState);
  await deliverSearchWinnerAsAFrozenStack(run, winner, target);
}

// The pointer is re-checked HERE, not when the search started: a long search
// gives the user time to close or change the candidate panel.
async function deliverSearchWinnerAsAFrozenStack(
  run: RopSearchRun,
  winner: RopCandidate,
  target: RopPanelTarget,
): Promise<void> {
  const request = buildRopKeepRequestOrNull(winner, target, run.derived);
  if (request === null) return;
  const { deliveryRef, state } = run.keep;
  const liveIndex = deliveryRef.current.resolveReplaceIndexOrNull(state.liveCandidatePanel);
  const situation = { liveCandidatePanelIndex: liveIndex, bestIsTheLiveCandidate: false };
  await carryOutRopKeepPlan(planRopKeep("search-winner", situation), request, run.keep);
}

function commitSearchWinner(winner: RopCandidate, setState: RopPanelStateWriter): void {
  setState((previous) => ({
    ...previous,
    current: winner,
    best: retainBestScoringRopCandidate(previous.best, winner),
  }));
}
