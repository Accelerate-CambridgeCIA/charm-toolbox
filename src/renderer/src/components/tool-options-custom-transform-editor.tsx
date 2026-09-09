import { useCallback } from "react";
import { notifyError } from "@/lib/notifications/notify";

import { ScriptDocsLink } from "@/components/script-docs-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildFormulaCubeTransformState,
  buildImportedToolCubeTransformState,
  formatCubeTransformStatusLine,
  type CubeTransformEditingState,
} from "@/lib/image/band-ops/cube-transform-editing";
import { useViewportRendering } from "@/state/viewport-rendering-context";

// The custom-transform controls embedded in the Custom Transform operation
// panel. The editor only CONFIGURES the run: the formula text writes through
// to ViewportRenderingState.cubeTransform as the user types, and Import
// script... just picks a .py/.zip file path (no Python runs here). Apply is
// what uploads the cube, runs the worker, and opens the transformed stack;
// see custom-transform-action.ts.

// Wallace (CT-349) read the cube as (height, width, bands) and chased phantom
// bugs; the panel now names the band-major order the scripting doc uses.
export const CUBE_SHAPE_NOTE =
  "cube is a NumPy array shaped (bands, height, width): cube[k] is band k as a height-by-width picture.";

interface ToolOptionsCustomTransformEditorProps {
  viewportIndex: number;
}

export function ToolOptionsCustomTransformEditor(
  props: ToolOptionsCustomTransformEditorProps,
): JSX.Element {
  const binding = useCubeTransformBinding(props.viewportIndex);
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground">Transform the whole stack</span>
      <CustomTransformInputControls binding={binding} />
      <CustomTransformStatus state={binding.state} />
      <p className="text-xs text-muted-foreground">
        Enter a formula or import a tool that returns a transformed stack with the same height
        and width as the source; the band count is free. Apply runs it on the stack and opens
        the result.
      </p>
      <p className="text-xs text-muted-foreground">{CUBE_SHAPE_NOTE}</p>
    </div>
  );
}

interface CubeTransformBinding {
  state: CubeTransformEditingState | null;
  setConfiguredTransform: (next: CubeTransformEditingState | null) => void;
}

function useCubeTransformBinding(viewportIndex: number): CubeTransformBinding {
  const renderingApi = useViewportRendering();
  const state = renderingApi.getRenderingState(viewportIndex).cubeTransform;
  const setConfiguredTransform = useCallback(
    (next: CubeTransformEditingState | null) => {
      const current = renderingApi.getRenderingState(viewportIndex);
      renderingApi.setRenderingState(viewportIndex, { ...current, cubeTransform: next });
    },
    [renderingApi, viewportIndex],
  );
  return { state, setConfiguredTransform };
}

interface CustomTransformControlProps {
  binding: CubeTransformBinding;
}

function CustomTransformInputControls(props: CustomTransformControlProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <CustomTransformFormulaField binding={props.binding} />
      <div className="flex items-center justify-between gap-2">
        <ImportCustomTransformScriptButton binding={props.binding} />
        <ScriptDocsLink />
      </div>
    </div>
  );
}

function CustomTransformFormulaField(props: CustomTransformControlProps): JSX.Element {
  const { state, setConfiguredTransform } = props.binding;
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
      Formula
      <Input
        aria-label="Transform formula"
        placeholder="e.g. cube * 2"
        value={state?.kind === "formula" ? state.expression : ""}
        onChange={(event) => setConfiguredTransform(buildFormulaCubeTransformState(event.target.value))}
        className="h-8 text-foreground"
      />
    </label>
  );
}

function ImportCustomTransformScriptButton(props: CustomTransformControlProps): JSX.Element {
  const pickScriptFile = () => pickCustomTransformScriptFile(props.binding.setConfiguredTransform);
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void pickScriptFile()}>
      Import script...
    </Button>
  );
}

async function pickCustomTransformScriptFile(
  setConfiguredTransform: (next: CubeTransformEditingState | null) => void,
): Promise<void> {
  try {
    const picked = await window.toolboxApi.pickUserScriptFile();
    if (picked.canceled) return;
    setConfiguredTransform(buildImportedToolCubeTransformState(picked.filePath, picked.fileName));
  } catch (error) {
    notifyError(error instanceof Error ? error.message : String(error));
  }
}

function CustomTransformStatus({ state }: { state: CubeTransformEditingState | null }): JSX.Element {
  return (
    <p className="text-xs font-medium text-foreground">{formatCubeTransformStatusLine(state)}</p>
  );
}
