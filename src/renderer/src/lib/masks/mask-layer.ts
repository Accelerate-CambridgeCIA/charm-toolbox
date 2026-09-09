import { buildNextPrefixedIdentifier } from "@/lib/masks/mask-identifiers";

// CT-302: a mask layer annotates one stack's spatial grid with labeled
// categories, so NPC, CNR, and L2 minimization can be told which pixels belong
// to what. The model is pure data: one Uint8Array over width x height where 0
// means unlabeled and 1..MAX_MASK_CATEGORY_COUNT is the 1-based index of the
// category painted there.
//
// The category colors below are DATA (they tint image pixels and their swatches
// are user-editable), not application chrome, so they are literal values here
// rather than theme tokens.

export interface MaskCategory {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface MaskLayer {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array;
  readonly categories: ReadonlyArray<MaskCategory>;
  readonly opacityPercent: number;
}

// A layer's data without the panel-assigned id: what an import produces and
// what the panel turns into a layer.
export type MaskLayerContent = Omit<MaskLayer, "id">;

export const MAX_MASK_CATEGORY_COUNT = 5;
export const MIN_MASK_CATEGORY_COUNT = 1;
export const UNLABELED_MASK_VALUE = 0;
export const DEFAULT_MASK_LAYER_OPACITY_PERCENT = 50;

export const DEFAULT_MASK_CATEGORY_COLORS: ReadonlyArray<string> = Object.freeze([
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#a855f7",
]);

export const DEFAULT_MASK_CATEGORY_NAMES: ReadonlyArray<string> = Object.freeze([
  "Foreground",
  "Background",
]);

const MASK_CATEGORY_ID_PREFIX = "category";

export function createMaskLayer(
  id: string,
  name: string,
  width: number,
  height: number,
): MaskLayer {
  return {
    id,
    name,
    width,
    height,
    values: new Uint8Array(width * height),
    categories: DEFAULT_MASK_CATEGORY_NAMES.map(buildDefaultMaskCategoryAtIndex),
    opacityPercent: DEFAULT_MASK_LAYER_OPACITY_PERCENT,
  };
}

function buildDefaultMaskCategoryAtIndex(name: string, index: number): MaskCategory {
  return buildMaskCategoryAtIndex(index, name, pickDefaultMaskCategoryColor(index));
}

// The category at a given 0-based position, named and coloured by the caller
// (an imported mask names its own; a new layer takes the defaults).
export function buildMaskCategoryAtIndex(
  index: number,
  name: string,
  color: string,
): MaskCategory {
  return { id: `${MASK_CATEGORY_ID_PREFIX}-${index + 1}`, name, color };
}

export function pickDefaultMaskCategoryName(index: number): string {
  return DEFAULT_MASK_CATEGORY_NAMES[index] ?? `Category ${index + 1}`;
}

export function pickDefaultMaskCategoryColor(index: number): string {
  const colors = DEFAULT_MASK_CATEGORY_COLORS;
  return colors[index % colors.length] ?? colors[0] ?? "#ef4444";
}

export function canAddCategoryToLayer(layer: MaskLayer): boolean {
  return layer.categories.length < MAX_MASK_CATEGORY_COUNT;
}

export function canDeleteCategoryFromLayer(layer: MaskLayer): boolean {
  return layer.categories.length > MIN_MASK_CATEGORY_COUNT;
}

export function addCategoryToLayer(layer: MaskLayer): MaskLayer {
  return appendNamedCategoryToLayer(layer, pickDefaultMaskCategoryName(layer.categories.length));
}

// CT-332: a category can also be named by the caller (the stem of the file
// that painted it), so the naming is a parameter and only the colour and the
// id stay derived from the layer's own list.
export function appendNamedCategoryToLayer(layer: MaskLayer, name: string): MaskLayer {
  if (!canAddCategoryToLayer(layer)) return layer;
  return { ...layer, categories: [...layer.categories, buildNextCategoryForLayer(layer, name)] };
}

function buildNextCategoryForLayer(layer: MaskLayer, name: string): MaskCategory {
  return {
    id: buildNextPrefixedIdentifier(
      MASK_CATEGORY_ID_PREFIX,
      layer.categories.map((category) => category.id),
    ),
    name,
    color: pickDefaultMaskCategoryColor(layer.categories.length),
  };
}

export function renameCategoryInLayer(
  layer: MaskLayer,
  categoryId: string,
  name: string,
): MaskLayer {
  return replaceCategoryInLayer(layer, categoryId, (category) => ({ ...category, name }));
}

export function recolorCategoryInLayer(
  layer: MaskLayer,
  categoryId: string,
  color: string,
): MaskLayer {
  return replaceCategoryInLayer(layer, categoryId, (category) => ({ ...category, color }));
}

function replaceCategoryInLayer(
  layer: MaskLayer,
  categoryId: string,
  replace: (category: MaskCategory) => MaskCategory,
): MaskLayer {
  const categories = layer.categories.map((category) =>
    category.id === categoryId ? replace(category) : category,
  );
  return { ...layer, categories };
}

// Deleting a category unlabels every pixel painted with it and shifts the
// higher category values down, so a stored value always matches its category's
// position in the list.
export function deleteCategoryFromLayer(layer: MaskLayer, categoryId: string): MaskLayer {
  const position = layer.categories.findIndex((category) => category.id === categoryId);
  if (position < 0 || !canDeleteCategoryFromLayer(layer)) return layer;
  return {
    ...layer,
    categories: layer.categories.filter((_, index) => index !== position),
    values: unlabelAndShiftValuesAfterRemoving(layer.values, position + 1),
  };
}

function unlabelAndShiftValuesAfterRemoving(
  values: Uint8Array,
  removedValue: number,
): Uint8Array {
  const next = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    next[index] = mapValueAfterRemovingCategoryValue(values[index] ?? 0, removedValue);
  }
  return next;
}

function mapValueAfterRemovingCategoryValue(value: number, removedValue: number): number {
  if (value === removedValue) return UNLABELED_MASK_VALUE;
  return value > removedValue ? value - 1 : value;
}

export function setMaskLayerOpacityPercent(layer: MaskLayer, percent: number): MaskLayer {
  return { ...layer, opacityPercent: clampOpacityPercent(percent) };
}

function clampOpacityPercent(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_MASK_LAYER_OPACITY_PERCENT;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export function doesMaskLayerCoverDimensions(
  layer: MaskLayer,
  width: number,
  height: number,
): boolean {
  return layer.width === width && layer.height === height;
}
