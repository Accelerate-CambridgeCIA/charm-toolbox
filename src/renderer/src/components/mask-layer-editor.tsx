import { Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import {
  addCategoryToLayer,
  canAddCategoryToLayer,
  canDeleteCategoryFromLayer,
  deleteCategoryFromLayer,
  MAX_MASK_CATEGORY_COUNT,
  recolorCategoryInLayer,
  renameCategoryInLayer,
  setMaskLayerOpacityPercent,
  type MaskCategory,
  type MaskLayer,
} from "@/lib/masks/mask-layer";
import { addMaskCategoriesFromFilesThroughOpenDialog } from "@/lib/masks/run-mask-import-flow";
import { notifyError } from "@/lib/notifications/notify";

// CT-302: the selected mask layer's own settings - its name, its labeled
// categories (max five, each with a free colour), and the overlay opacity.

export interface MaskLayerEditorProps {
  readonly layer: MaskLayer;
  readonly onChangeLayer: (next: MaskLayer) => void;
  readonly onDeleteLayer: () => void;
}

export function MaskLayerEditor(props: MaskLayerEditorProps): JSX.Element {
  return (
    <section aria-label="Selected mask layer" className="flex flex-col gap-3">
      <MaskLayerNameRow
        layer={props.layer}
        onChangeLayer={props.onChangeLayer}
        onDeleteLayer={props.onDeleteLayer}
      />
      <MaskCategoryList layer={props.layer} onChangeLayer={props.onChangeLayer} />
      <MaskLayerOpacityRow layer={props.layer} onChangeLayer={props.onChangeLayer} />
    </section>
  );
}

function MaskLayerNameRow(props: MaskLayerEditorProps): JSX.Element {
  return (
    <div className="flex items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
        Layer name
        <Input
          aria-label="Layer name"
          value={props.layer.name}
          onChange={(event) => props.onChangeLayer({ ...props.layer, name: event.target.value })}
        />
      </label>
      <Button variant="ghost" size="icon" aria-label="Delete layer" onClick={props.onDeleteLayer}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

interface MaskCategoryListProps {
  readonly layer: MaskLayer;
  readonly onChangeLayer: (next: MaskLayer) => void;
}

function MaskCategoryList(props: MaskCategoryListProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Categories</span>
      {props.layer.categories.map((category, position) => (
        <MaskCategoryRow
          key={category.id}
          category={category}
          position={position + 1}
          layer={props.layer}
          onChangeLayer={props.onChangeLayer}
        />
      ))}
      <AddMaskCategoryButtonRow layer={props.layer} onChangeLayer={props.onChangeLayer} />
    </div>
  );
}

// CT-332: the two ways to add a category sit side by side. The row wraps
// because "Add category from file" cannot shrink below its label inside the
// aside's fixed width.
function AddMaskCategoryButtonRow(props: MaskCategoryListProps): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      <AddMaskCategoryButton {...props} />
      <AddMaskCategoryFromFileButton {...props} />
    </div>
  );
}

function AddMaskCategoryFromFileButton(props: MaskCategoryListProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex-1">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={!canAddCategoryToLayer(props.layer)}
            onClick={() => void addCategoriesFromPickedMaskFiles(props)}
          >
            <Upload className="size-4" />
            Add category from file
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Add each picked PNG as a new category</TooltipContent>
    </Tooltip>
  );
}

async function addCategoriesFromPickedMaskFiles(props: MaskCategoryListProps): Promise<void> {
  try {
    const added = await addMaskCategoriesFromFilesThroughOpenDialog(props.layer);
    if (!added.canceled) props.onChangeLayer(added.layer);
  } catch (error) {
    notifyError(describeElectronInvokeFailure(error));
  }
}

function AddMaskCategoryButton(props: MaskCategoryListProps): JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      className="flex-1"
      disabled={!canAddCategoryToLayer(props.layer)}
      onClick={() => props.onChangeLayer(addCategoryToLayer(props.layer))}
    >
      Add category
      <span className="ml-1 font-mono text-xs text-muted-foreground">
        {props.layer.categories.length}/{MAX_MASK_CATEGORY_COUNT}
      </span>
    </Button>
  );
}

interface MaskCategoryRowProps extends MaskCategoryListProps {
  readonly category: MaskCategory;
  readonly position: number;
}

function MaskCategoryRow(props: MaskCategoryRowProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <MaskCategoryColorSwatch {...props} />
      <Input
        aria-label={`Category ${props.position} name`}
        value={props.category.name}
        onChange={(event) => props.onChangeLayer(renameCategory(props, event.target.value))}
      />
      <DeleteMaskCategoryButton {...props} />
    </div>
  );
}

function renameCategory(props: MaskCategoryRowProps, name: string): MaskLayer {
  return renameCategoryInLayer(props.layer, props.category.id, name);
}

function MaskCategoryColorSwatch(props: MaskCategoryRowProps): JSX.Element {
  return (
    <input
      type="color"
      aria-label={`Category ${props.position} color`}
      value={props.category.color}
      onChange={(event) =>
        props.onChangeLayer(
          recolorCategoryInLayer(props.layer, props.category.id, event.target.value),
        )
      }
      className="size-8 shrink-0 cursor-pointer rounded-md border bg-card p-1"
    />
  );
}

function DeleteMaskCategoryButton(props: MaskCategoryRowProps): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Delete category ${props.position}`}
      disabled={!canDeleteCategoryFromLayer(props.layer)}
      onClick={() =>
        props.onChangeLayer(deleteCategoryFromLayer(props.layer, props.category.id))
      }
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

function MaskLayerOpacityRow(props: MaskCategoryListProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">Layer opacity</span>
        <span className="font-mono text-xs text-muted-foreground">
          {props.layer.opacityPercent}%
        </span>
      </div>
      <Slider
        aria-label="Layer opacity"
        min={0}
        max={100}
        step={1}
        value={[props.layer.opacityPercent]}
        onValueChange={([next]) => props.onChangeLayer(setOpacity(props.layer, next))}
      />
    </div>
  );
}

function setOpacity(layer: MaskLayer, percent: number | undefined): MaskLayer {
  return setMaskLayerOpacityPercent(layer, percent ?? layer.opacityPercent);
}
