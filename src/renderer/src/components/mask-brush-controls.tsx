import { Eraser } from "lucide-react";

import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  clampMaskBrushSizePx,
  MAX_MASK_BRUSH_SIZE_PX,
  MIN_MASK_BRUSH_SIZE_PX,
  resolveArmedBrushCategoryGroupValue,
  type MaskBrushSettings,
} from "@/lib/masks/mask-brush";
import type { MaskCategory, MaskLayer } from "@/lib/masks/mask-layer";

// CT-304: the brush the Masks tool paints with - which category it lays down,
// whether it erases instead, and how wide it is in IMAGE pixels. The settings
// are tool-wide (masks-tool-context), so switching layers keeps the brush.

export interface MaskBrushControlsProps {
  readonly layer: MaskLayer;
  readonly brush: MaskBrushSettings;
  readonly onChangeBrush: (next: MaskBrushSettings) => void;
}

export function MaskBrushControls(props: MaskBrushControlsProps): JSX.Element {
  return (
    <section aria-label="Mask brush" className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground">Brush</span>
      <BrushCategoryChoice {...props} />
      <EraserToggle {...props} />
      <BrushSizeRow {...props} />
    </section>
  );
}

function BrushCategoryChoice(props: MaskBrushControlsProps): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      aria-label="Brush category"
      className="flex-col items-stretch gap-1"
      value={resolveArmedBrushCategoryGroupValue(props.brush)}
      onValueChange={(next) => selectBrushCategoryWhenChosen(next, props)}
    >
      {props.layer.categories.map((category, position) => (
        <BrushCategoryOption key={category.id} category={category} categoryIndex={position + 1} />
      ))}
    </ToggleGroup>
  );
}

// Radix reports an empty string when the pressed item is clicked again; ignore
// it so exactly one category stays armed.
function selectBrushCategoryWhenChosen(value: string, props: MaskBrushControlsProps): void {
  if (value === "") return;
  props.onChangeBrush({
    ...props.brush,
    selectedCategoryIndex: Number(value),
    isEraserEnabled: false,
  });
}

interface BrushCategoryOptionProps {
  readonly category: MaskCategory;
  readonly categoryIndex: number;
}

function BrushCategoryOption(props: BrushCategoryOptionProps): JSX.Element {
  return (
    <ToggleGroupItem value={String(props.categoryIndex)} className="justify-start gap-2">
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-sm border"
        style={{ backgroundColor: props.category.color }}
      />
      <span className="truncate">{props.category.name}</span>
    </ToggleGroupItem>
  );
}

function EraserToggle(props: MaskBrushControlsProps): JSX.Element {
  return (
    <Toggle
      variant="outline"
      size="sm"
      aria-label="Eraser"
      pressed={props.brush.isEraserEnabled}
      onPressedChange={(pressed) =>
        props.onChangeBrush({ ...props.brush, isEraserEnabled: pressed })
      }
      className="justify-start"
    >
      <Eraser />
      Eraser
    </Toggle>
  );
}

function BrushSizeRow(props: MaskBrushControlsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">Brush size</span>
        <span className="font-mono text-xs text-muted-foreground">
          {props.brush.brushSizePx} px
        </span>
      </div>
      <Slider
        aria-label="Brush size"
        min={MIN_MASK_BRUSH_SIZE_PX}
        max={MAX_MASK_BRUSH_SIZE_PX}
        step={1}
        value={[props.brush.brushSizePx]}
        onValueChange={([next]) => changeBrushSize(props, next)}
      />
    </div>
  );
}

function changeBrushSize(props: MaskBrushControlsProps, sizePx: number | undefined): void {
  props.onChangeBrush({
    ...props.brush,
    brushSizePx: clampMaskBrushSizePx(sizePx ?? props.brush.brushSizePx),
  });
}
