import { useEffect, useId, useState } from "react";
import { notifyError } from "@/lib/notifications/notify";

import { Button } from "@/components/ui/button";
import {
  PANEL_NUMERIC_INPUT_CLASSES,
  PANEL_SELECT_CLASSES,
} from "@/components/form-control-classes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useNumericInputDraft } from "@/components/use-numeric-input-draft";
import { pickAndRememberReferenceRasterFromDisk } from "@/lib/image/pick-reference-raster";
import {
  BAND_RANGE_SYNTAX_EXAMPLES,
} from "@/lib/image/parse-band-range";
import {
  filterLoadedReferenceCandidatesByDimensions,
  readReferenceTokenDisplayName,
  type LoadedReferenceCandidate,
} from "@/lib/image/reference-token";
import {
  formatComponentCountLabel,
  resolveComponentCount,
} from "@/lib/image/dimension-reduction/component-count";
import { describeSliderTrackForSchema } from "@/lib/actions/log-symmetric-slider-scale";
import {
  clampNumericParameterValueToSchema,
  clampSliderParameterValueToSchema,
  describeBandNumberRangeErrorOrNull,
  describeClipBoundsErrorOrNull,
  describeCubeScopeBandRangeErrorOrNull,
  isParameterSchemaVisibleForSource,
  readBandNumberOrDefault,
  readBandRangeTextOrEmpty,
  readClipBoundOrDefault,
  readCubeScopeChoiceOrDefault,
  readMaskLayerIdOrEmpty,
  readRasterReferenceTokenOrEmpty,
  shouldShowCubeScopeControl,
  NO_RASTER_REFERENCE_SELECTED,
  type BandNumberParameterSchema,
  type BooleanParameterSchema,
  type ClipBoundsParameterSchema,
  type ComponentCountParameterSchema,
  type CubeScopeChoice,
  type CubeScopeParameterSchema,
  type EnumParameterSchema,
  type IntegerParameterSchema,
  type MaskLayerParameterSchema,
  type NumberParameterSchema,
  type ParameterSchema,
  type RasterReferenceParameterSchema,
  type SliderParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "@/lib/actions/parameter-schema";
import { listMaskLayersQualifyingForL2 } from "@/lib/analysis/l2-minimization-qualification";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import { EMPTY_MASK_PANEL_STATE, type MaskPanelState } from "@/lib/masks/mask-panel";
import { syncRememberedMaskLayers } from "@/lib/masks/mask-layer-reference-store";

interface ParameterFormSectionProps {
  schemas: ReadonlyArray<ParameterSchema>;
  values: ParameterValuesById;
  onChangeValue: (id: string, next: ParameterValue) => void;
  sourceBandCount?: number | null;
  sourceIsTrueColorComposite?: boolean;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  sourceOwnLoadedPanelToken?: string | null;
  loadedReferenceCandidates?: ReadonlyArray<LoadedReferenceCandidate>;
  maskPanelState?: MaskPanelState | null;
}

export function ParameterFormSection(props: ParameterFormSectionProps): JSX.Element {
  return (
    <section className="flex flex-col gap-3" aria-label="Parameters">
      <span className="text-xs font-medium text-muted-foreground">Parameters</span>
      {props.schemas.map((schema) => (
        <ParameterFieldRow
          key={schema.id}
          schema={schema}
          value={readParameterRowValue(schema, props.values)}
          allValues={props.values}
          sourceBandCount={props.sourceBandCount ?? null}
          sourceIsTrueColorComposite={props.sourceIsTrueColorComposite ?? false}
          sourceWidth={props.sourceWidth ?? null}
          sourceHeight={props.sourceHeight ?? null}
          sourceOwnLoadedPanelToken={props.sourceOwnLoadedPanelToken ?? null}
          loadedReferenceCandidates={props.loadedReferenceCandidates ?? EMPTY_REFERENCE_CANDIDATES}
          maskPanelState={props.maskPanelState ?? null}
          onChangeValue={(next) => props.onChangeValue(schema.id, next)}
          onChangeValueAtId={props.onChangeValue}
        />
      ))}
    </section>
  );
}

const EMPTY_REFERENCE_CANDIDATES: ReadonlyArray<LoadedReferenceCandidate> = [];

// A clip-bounds field owns two values keyed by its own ids, so it has no single
// schema-level value/default; its component reads both from allValues instead.
function readParameterRowValue(schema: ParameterSchema, values: ParameterValuesById): ParameterValue {
  if (schema.kind === "clip-bounds") return values[schema.id] ?? 0;
  return values[schema.id] ?? schema.defaultValue;
}

interface ParameterFieldRowProps {
  schema: ParameterSchema;
  value: ParameterValue;
  allValues: ParameterValuesById;
  sourceBandCount: number | null;
  sourceIsTrueColorComposite: boolean;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceOwnLoadedPanelToken: string | null;
  loadedReferenceCandidates: ReadonlyArray<LoadedReferenceCandidate>;
  maskPanelState: MaskPanelState | null;
  onChangeValue: (next: ParameterValue) => void;
  onChangeValueAtId: (id: string, next: ParameterValue) => void;
}

function ParameterFieldRow(props: ParameterFieldRowProps): JSX.Element | null {
  if (!isParameterSchemaVisibleForSource(props.schema, props.allValues, props.sourceIsTrueColorComposite)) {
    return null;
  }
  if (isHiddenCubeScopeRow(props.schema, props.sourceBandCount)) return null;
  if (isHiddenSingleBandSourceRow(props.schema, props.sourceBandCount)) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <ParameterFieldInput
        schema={props.schema}
        value={props.value}
        allValues={props.allValues}
        sourceBandCount={props.sourceBandCount}
        sourceIsTrueColorComposite={props.sourceIsTrueColorComposite}
        sourceWidth={props.sourceWidth}
        sourceHeight={props.sourceHeight}
        sourceOwnLoadedPanelToken={props.sourceOwnLoadedPanelToken}
        loadedReferenceCandidates={props.loadedReferenceCandidates}
        maskPanelState={props.maskPanelState}
        onChangeValue={props.onChangeValue}
        onChangeValueAtId={props.onChangeValueAtId}
      />
      {props.schema.description ? (
        <span className="text-xs text-muted-foreground">{props.schema.description}</span>
      ) : null}
    </div>
  );
}

function isHiddenCubeScopeRow(schema: ParameterSchema, sourceBandCount: number | null): boolean {
  return schema.kind === "cube-scope" && !shouldShowCubeScopeControl(sourceBandCount);
}

// CT-282: a field flagged hiddenForSingleBandSource is a scope-style choice that
// is redundant for one band, so it hides exactly like the cube-scope control.
function isHiddenSingleBandSourceRow(
  schema: ParameterSchema,
  sourceBandCount: number | null,
): boolean {
  return Boolean(schema.hiddenForSingleBandSource) && !shouldShowCubeScopeControl(sourceBandCount);
}

function ParameterFieldInput(props: ParameterFieldRowProps): JSX.Element {
  if (props.schema.kind === "boolean") {
    return (
      <BooleanParameterField
        schema={props.schema}
        value={readBooleanValueOrDefault(props.value, props.schema.defaultValue)}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "enum") {
    return (
      <EnumParameterField
        schema={props.schema}
        value={readStringValueOrDefault(props.value, props.schema.defaultValue)}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "cube-scope") {
    const bandRangeParameterId = props.schema.bandRangeParameterId;
    return (
      <CubeScopeParameterField
        schema={props.schema}
        value={readCubeScopeChoiceOrDefault(props.value, props.schema.defaultValue)}
        bandRangeText={readBandRangeTextOrEmpty(props.allValues[bandRangeParameterId])}
        sourceBandCount={props.sourceBandCount}
        onChangeValue={props.onChangeValue}
        onChangeBandRangeText={(next) => props.onChangeValueAtId(bandRangeParameterId, next)}
      />
    );
  }
  if (props.schema.kind === "raster-reference") {
    return (
      <RasterReferenceParameterField
        schema={props.schema}
        value={readRasterReferenceTokenOrEmpty(props.value)}
        loadedReferenceCandidates={props.loadedReferenceCandidates}
        sourceWidth={props.sourceWidth}
        sourceHeight={props.sourceHeight}
        sourceOwnLoadedPanelToken={props.sourceOwnLoadedPanelToken}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "mask-layer") {
    return (
      <MaskLayerParameterField
        schema={props.schema}
        value={readMaskLayerIdOrEmpty(props.value)}
        maskPanelState={props.maskPanelState}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "slider") {
    return (
      <SliderParameterField
        schema={props.schema}
        value={readNumericValueOrDefault(props.value, props.schema.defaultValue)}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "band-number") {
    return (
      <BandNumberParameterField
        schema={props.schema}
        value={readNumericValueOrDefault(props.value, props.schema.defaultValue)}
        sourceBandCount={props.sourceBandCount}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "component-count") {
    return (
      <ComponentCountParameterField
        schema={props.schema}
        value={readNumericValueOrDefault(props.value, props.schema.defaultValue)}
        sourceBandCount={props.sourceBandCount}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  if (props.schema.kind === "clip-bounds") {
    return (
      <ClipBoundsParameterField
        schema={props.schema}
        allValues={props.allValues}
        onChangeValueAtId={props.onChangeValueAtId}
      />
    );
  }
  return (
    <NumericParameterField
      schema={props.schema}
      value={readNumericValueOrDefault(props.value, props.schema.defaultValue)}
      onChangeValue={props.onChangeValue}
    />
  );
}

function readNumericValueOrDefault(value: ParameterValue, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function readStringValueOrDefault(value: ParameterValue, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBooleanValueOrDefault(value: ParameterValue, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

interface NumericParameterFieldProps {
  schema: NumberParameterSchema | IntegerParameterSchema;
  value: number;
  onChangeValue: (next: number) => void;
}

function NumericParameterField(props: NumericParameterFieldProps): JSX.Element {
  const id = useId();
  const stepValue = resolveNumericInputStep(props.schema);
  const input = useNumericInputDraft(props.value, (next) =>
    props.onChangeValue(clampNumericParameterValueToSchema(props.schema, next)),
  );
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <input
        id={id}
        type="number"
        value={input.draft}
        min={props.schema.min}
        max={props.schema.max}
        step={stepValue}
        onChange={(event) => input.onChangeRawValue(event.target.value)}
        onBlur={input.onBlur}
        className={PANEL_NUMERIC_INPUT_CLASSES}
      />
    </label>
  );
}


function resolveNumericInputStep(
  schema: NumberParameterSchema | IntegerParameterSchema,
): number | string {
  if (schema.kind === "integer") return 1;
  return schema.step ?? "any";
}

function parseNumericInputValueOrFallback(rawValue: string, fallback: number): number {
  const trimmed = rawValue.trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface BandNumberParameterFieldProps {
  schema: BandNumberParameterSchema;
  value: number;
  sourceBandCount: number | null;
  onChangeValue: (next: number) => void;
}

function BandNumberParameterField(props: BandNumberParameterFieldProps): JSX.Element {
  const id = useId();
  const rangeError = describeBandNumberRangeErrorOrNull(props.value, props.sourceBandCount);
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <input
        id={id}
        type="number"
        value={props.value}
        min={1}
        max={props.sourceBandCount ?? undefined}
        step={1}
        aria-invalid={rangeError !== null}
        onChange={(event) =>
          props.onChangeValue(readBandNumberOrDefault(parseNumericInputValueOrFallback(event.target.value, props.value), props.value))
        }
        className={cn(PANEL_NUMERIC_INPUT_CLASSES, rangeError && "border-destructive focus:ring-destructive")}
      />
      {rangeError ? <span className="text-xs text-destructive">{rangeError}</span> : null}
    </label>
  );
}

interface ComponentCountParameterFieldProps {
  schema: ComponentCountParameterSchema;
  value: number;
  sourceBandCount: number | null;
  onChangeValue: (next: number) => void;
}

function ComponentCountParameterField(props: ComponentCountParameterFieldProps): JSX.Element {
  const id = useId();
  const bandCount = props.sourceBandCount;
  const displayValue = bandCount === null ? props.value : resolveComponentCount(props.value, bandCount);
  return (
    // The "X of N components" hint sits OUTSIDE the <label> so the input's accessible
    // name stays exactly the field label, not the label plus the live hint text.
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-foreground">
        {props.schema.label}
      </label>
      <input
        id={id}
        type="number"
        value={displayValue}
        min={1}
        max={bandCount ?? undefined}
        step={1}
        onChange={(event) =>
          props.onChangeValue(
            clampComponentCountInput(event.target.value, displayValue, bandCount),
          )
        }
        className={PANEL_NUMERIC_INPUT_CLASSES}
      />
      {bandCount !== null ? (
        <span className="text-xs text-muted-foreground">
          {formatComponentCountLabel(displayValue, bandCount)} components
        </span>
      ) : null}
    </div>
  );
}

function clampComponentCountInput(
  rawValue: string,
  fallback: number,
  bandCount: number | null,
): number {
  const parsed = parseNumericInputValueOrFallback(rawValue, fallback);
  if (bandCount === null) return Math.max(1, Math.round(parsed));
  return resolveComponentCount(parsed, bandCount);
}

interface ClipBoundsParameterFieldProps {
  schema: ClipBoundsParameterSchema;
  allValues: ParameterValuesById;
  onChangeValueAtId: (id: string, next: ParameterValue) => void;
}

function ClipBoundsParameterField(props: ClipBoundsParameterFieldProps): JSX.Element {
  const lo = readClipBoundOrDefault(props.allValues[props.schema.loParameterId], props.schema.defaultLo);
  const hi = readClipBoundOrDefault(props.allValues[props.schema.hiParameterId], props.schema.defaultHi);
  const error = describeClipBoundsErrorOrNull(lo, hi);
  return (
    <div className="flex flex-col gap-2">
      <ClipBoundNumberInput
        label={props.schema.loLabel}
        value={lo}
        invalid={error !== null}
        onChangeValue={(next) => props.onChangeValueAtId(props.schema.loParameterId, next)}
      />
      <ClipBoundNumberInput
        label={props.schema.hiLabel}
        value={hi}
        invalid={error !== null}
        onChangeValue={(next) => props.onChangeValueAtId(props.schema.hiParameterId, next)}
      />
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

interface ClipBoundNumberInputProps {
  label: string;
  value: number;
  invalid: boolean;
  onChangeValue: (next: number) => void;
}

function ClipBoundNumberInput(props: ClipBoundNumberInputProps): JSX.Element {
  const id = useId();
  const input = useNumericInputDraft(props.value, props.onChangeValue);
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.label}</span>
      <input
        id={id}
        type="number"
        value={input.draft}
        step="any"
        aria-invalid={props.invalid}
        onChange={(event) => input.onChangeRawValue(event.target.value)}
        onBlur={input.onBlur}
        className={cn(PANEL_NUMERIC_INPUT_CLASSES, props.invalid && "border-destructive focus:ring-destructive")}
      />
    </label>
  );
}

interface SliderParameterFieldProps {
  schema: SliderParameterSchema;
  value: number;
  onChangeValue: (next: number) => void;
}

function SliderParameterField(props: SliderParameterFieldProps): JSX.Element {
  const id = useId();
  const track = describeSliderTrackForSchema(props.schema, props.value);
  const commitThumbPosition = (thumbPositions: number[]): void =>
    props.onChangeValue(
      clampSliderParameterValueToSchema(
        props.schema,
        track.valueAtThumbPosition(thumbPositions[0] ?? track.thumbPosition),
      ),
    );
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-foreground">
          {props.schema.label}
        </label>
        <span className="font-mono text-xs text-muted-foreground">
          {formatSliderValueWithSuffix(props.value, props.schema.valueSuffix)}
        </span>
      </div>
      <Slider
        id={id}
        aria-label={props.schema.label}
        min={track.trackMin}
        max={track.trackMax}
        step={track.trackStep}
        value={[track.thumbPosition]}
        onValueChange={commitThumbPosition}
      />
    </div>
  );
}

function formatSliderValueWithSuffix(value: number, valueSuffix: string | undefined): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return valueSuffix ? `${formatted}${valueSuffix}` : formatted;
}

interface EnumParameterFieldProps {
  schema: EnumParameterSchema;
  value: string;
  onChangeValue: (next: string) => void;
}

function EnumParameterField(props: EnumParameterFieldProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <select
        id={id}
        value={props.value}
        onChange={(event) => props.onChangeValue(event.target.value)}
        className={PANEL_SELECT_CLASSES}
      >
        {props.schema.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}


interface CubeScopeParameterFieldProps {
  schema: CubeScopeParameterSchema;
  value: CubeScopeChoice;
  bandRangeText: string;
  sourceBandCount: number | null;
  onChangeValue: (next: CubeScopeChoice) => void;
  onChangeBandRangeText: (next: string) => void;
}

function CubeScopeParameterField(props: CubeScopeParameterFieldProps): JSX.Element {
  const radioGroupName = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm text-foreground">{props.schema.label}</legend>
      <CubeScopeRadioRow
        radioGroupName={radioGroupName}
        choice="full-cube"
        label="Full stack"
        currentChoice={props.value}
        onSelect={props.onChangeValue}
      />
      <CubeScopeRadioRow
        radioGroupName={radioGroupName}
        choice="band-wise"
        label="Band-wise (enter bands)"
        currentChoice={props.value}
        onSelect={props.onChangeValue}
      />
      {props.value === "band-wise" ? (
        <BandRangeTextInput
          schema={props.schema}
          value={props.bandRangeText}
          sourceBandCount={props.sourceBandCount}
          onChangeValue={props.onChangeBandRangeText}
        />
      ) : null}
    </fieldset>
  );
}

interface BandRangeTextInputProps {
  schema: CubeScopeParameterSchema;
  value: string;
  sourceBandCount: number | null;
  onChangeValue: (next: string) => void;
}

// CT-287: no inline syntax hint here; the scope field's schema description is
// the single band-list help sentence shown for the whole row.
function BandRangeTextInput(props: BandRangeTextInputProps): JSX.Element {
  const id = useId();
  const rangeError = describeCubeScopeBandRangeErrorOrNull(props.schema, props.value, props.sourceBandCount);
  return (
    <div className="flex flex-col gap-1 pl-6 text-sm">
      <input
        id={id}
        type="text"
        value={props.value}
        placeholder={BAND_RANGE_SYNTAX_EXAMPLES}
        aria-label="Bands to process"
        aria-invalid={rangeError !== null}
        onChange={(event) => props.onChangeValue(event.target.value)}
        className={cn(PANEL_NUMERIC_INPUT_CLASSES, rangeError && "border-destructive focus:ring-destructive")}
      />
      {rangeError ? <span className="text-xs text-destructive">{rangeError}</span> : null}
    </div>
  );
}

interface CubeScopeRadioRowProps {
  radioGroupName: string;
  choice: CubeScopeChoice;
  label: string;
  currentChoice: CubeScopeChoice;
  onSelect: (choice: CubeScopeChoice) => void;
}

function CubeScopeRadioRow(props: CubeScopeRadioRowProps): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        className="size-4 cursor-pointer accent-primary"
        name={props.radioGroupName}
        checked={props.currentChoice === props.choice}
        onChange={() => props.onSelect(props.choice)}
      />
      <span>{props.label}</span>
    </label>
  );
}

interface RasterReferenceParameterFieldProps {
  schema: RasterReferenceParameterSchema;
  value: string;
  loadedReferenceCandidates: ReadonlyArray<LoadedReferenceCandidate>;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceOwnLoadedPanelToken: string | null;
  onChangeValue: (next: string) => void;
}

function RasterReferenceParameterField(props: RasterReferenceParameterFieldProps): JSX.Element {
  const [isPicking, setIsPicking] = useState(false);
  const selectedFileName = readBaseFileNameFromTokenOrNull(props.value);
  if (props.schema.restrictToLoadedPanelsMatchingSourceDimensions) {
    return (
      <RestrictedLoadedPanelReferenceField
        schema={props.schema}
        selectedFileName={selectedFileName}
        candidates={resolveDimensionMatchingCandidates(props)}
        onChangeValue={props.onChangeValue}
      />
    );
  }
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <RasterReferenceSelectedFileText fileName={selectedFileName} optional={props.schema.optional} />
      <RasterReferencePickerButtons
        hasSelection={selectedFileName !== null}
        optional={props.schema.optional}
        isPicking={isPicking}
        onPick={() => void pickReferenceRasterIntoField(props.onChangeValue, setIsPicking)}
        onClear={() => props.onChangeValue(NO_RASTER_REFERENCE_SELECTED)}
      />
      <LoadedPanelReferenceMenu
        candidates={props.loadedReferenceCandidates}
        onSelectToken={props.onChangeValue}
      />
    </div>
  );
}

function resolveDimensionMatchingCandidates(
  props: RasterReferenceParameterFieldProps,
): ReadonlyArray<LoadedReferenceCandidate> {
  if (props.sourceWidth === null || props.sourceHeight === null) return [];
  return filterLoadedReferenceCandidatesByDimensions(
    props.loadedReferenceCandidates,
    props.sourceWidth,
    props.sourceHeight,
    props.sourceOwnLoadedPanelToken ?? undefined,
  );
}

interface RestrictedLoadedPanelReferenceFieldProps {
  schema: RasterReferenceParameterSchema;
  selectedFileName: string | null;
  candidates: ReadonlyArray<LoadedReferenceCandidate>;
  onChangeValue: (next: string) => void;
}

// CT-300: Concatenate Stacks offers loaded panels ONLY (no file picker), scoped
// to panels whose stack matches the active stack's width and height.
function RestrictedLoadedPanelReferenceField(props: RestrictedLoadedPanelReferenceFieldProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <RasterReferenceSelectedFileText fileName={props.selectedFileName} optional={props.schema.optional} />
      {props.candidates.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          No open stack matches the active stack&apos;s width and height.
        </span>
      ) : (
        <LoadedPanelReferenceMenu candidates={props.candidates} onSelectToken={props.onChangeValue} />
      )}
    </div>
  );
}

interface LoadedPanelReferenceMenuProps {
  candidates: ReadonlyArray<LoadedReferenceCandidate>;
  onSelectToken: (token: string) => void;
}

function LoadedPanelReferenceMenu(props: LoadedPanelReferenceMenuProps): JSX.Element | null {
  if (props.candidates.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Use a loaded panel...
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {props.candidates.map((candidate) => (
          <DropdownMenuItem key={candidate.token} onSelect={() => props.onSelectToken(candidate.token)}>
            {candidate.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface MaskLayerParameterFieldProps {
  schema: MaskLayerParameterSchema;
  value: string;
  maskPanelState: MaskPanelState | null;
  onChangeValue: (next: string) => void;
}

// CT-313: L2 minimization's mask layer picker. The candidate list is the
// panel's own qualifying layers (>= 2 painted categories, the same rule NPC
// uses); every render syncs them into the mask-layer reference store so
// transformSourceAsync can resolve the CHOSEN one synchronously at Apply time
// (ParameterValuesById can only carry the layer's id, never its pixel data).
function MaskLayerParameterField(props: MaskLayerParameterFieldProps): JSX.Element {
  const qualifyingLayers = listMaskLayersQualifyingForL2(props.maskPanelState ?? EMPTY_MASK_PANEL_STATE);
  useSyncQualifyingMaskLayersIntoReferenceStore(qualifyingLayers);
  useAutoSelectDefaultMaskLayer(
    props.value,
    qualifyingLayers,
    props.maskPanelState?.selectedLayerId ?? null,
    props.onChangeValue,
  );
  const selectedLayer = qualifyingLayers.find((layer) => layer.id === props.value) ?? null;
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      {qualifyingLayers.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          No usable mask layer. Add one with the Masks tool and paint at least two categories.
        </span>
      ) : (
        <MaskLayerReferenceMenu
          selectedLayer={selectedLayer}
          qualifyingLayers={qualifyingLayers}
          onSelectLayerId={props.onChangeValue}
        />
      )}
    </div>
  );
}

function useSyncQualifyingMaskLayersIntoReferenceStore(layers: ReadonlyArray<MaskLayer>): void {
  useEffect(() => {
    syncRememberedMaskLayers(layers);
  }, [layers]);
}

// The field defaults to the Masks tool's own selected layer (when it
// qualifies) and otherwise to the first usable one, so opening the panel
// needs no click in the common case; an explicit choice that still qualifies
// is left alone.
function useAutoSelectDefaultMaskLayer(
  value: string,
  qualifyingLayers: ReadonlyArray<MaskLayer>,
  preferredLayerId: string | null,
  onChangeValue: (next: string) => void,
): void {
  useEffect(() => {
    if (qualifyingLayers.some((layer) => layer.id === value)) return;
    const next = findMaskLayerById(qualifyingLayers, preferredLayerId) ?? qualifyingLayers[0] ?? null;
    if (next && next.id !== value) onChangeValue(next.id);
  }, [value, qualifyingLayers, preferredLayerId, onChangeValue]);
}

function findMaskLayerById(
  layers: ReadonlyArray<MaskLayer>,
  layerId: string | null,
): MaskLayer | null {
  if (layerId === null) return null;
  return layers.find((layer) => layer.id === layerId) ?? null;
}

interface MaskLayerReferenceMenuProps {
  selectedLayer: MaskLayer | null;
  qualifyingLayers: ReadonlyArray<MaskLayer>;
  onSelectLayerId: (layerId: string) => void;
}

function MaskLayerReferenceMenu(props: MaskLayerReferenceMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {props.selectedLayer?.name ?? "Choose a mask layer..."}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {props.qualifyingLayers.map((layer) => (
          <DropdownMenuItem key={layer.id} onSelect={() => props.onSelectLayerId(layer.id)}>
            {layer.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function pickReferenceRasterIntoField(
  onChangeValue: (next: string) => void,
  setIsPicking: (next: boolean) => void,
): Promise<void> {
  setIsPicking(true);
  try {
    const picked = await pickAndRememberReferenceRasterFromDisk();
    if (picked) onChangeValue(picked.token);
  } catch (error) {
    notifyError(describeReferencePickError(error));
  } finally {
    setIsPicking(false);
  }
}

function describeReferencePickError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readBaseFileNameFromTokenOrNull(token: string): string | null {
  if (token === NO_RASTER_REFERENCE_SELECTED) return null;
  return readReferenceTokenDisplayName(token);
}

interface RasterReferenceSelectedFileTextProps {
  fileName: string | null;
  optional: boolean;
}

function RasterReferenceSelectedFileText(props: RasterReferenceSelectedFileTextProps): JSX.Element {
  if (props.fileName) {
    return (
      <span className="truncate font-mono text-xs text-foreground" title={props.fileName}>
        {props.fileName}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">
      {props.optional ? "No file selected (optional)" : "No file selected"}
    </span>
  );
}

interface RasterReferencePickerButtonsProps {
  hasSelection: boolean;
  optional: boolean;
  isPicking: boolean;
  onPick: () => void;
  onClear: () => void;
}

function RasterReferencePickerButtons(props: RasterReferencePickerButtonsProps): JSX.Element {
  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" disabled={props.isPicking} onClick={props.onPick}>
        {props.hasSelection ? "Replace file..." : "Choose file..."}
      </Button>
      {props.optional && props.hasSelection ? (
        <Button type="button" variant="ghost" size="sm" onClick={props.onClear}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}

interface BooleanParameterFieldProps {
  schema: BooleanParameterSchema;
  value: boolean;
  onChangeValue: (next: boolean) => void;
}

function BooleanParameterField(props: BooleanParameterFieldProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span className="text-foreground">{props.schema.label}</span>
      <Switch id={id} checked={props.value} onCheckedChange={props.onChangeValue} />
    </label>
  );
}
