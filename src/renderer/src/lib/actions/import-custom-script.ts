import { notifyError } from "@/lib/notifications/notify";
import {
  buildImportedToolCubeTransformState,
  type CubeTransformEditingState,
} from "@/lib/image/band-ops/cube-transform-editing";
import type { ViewportRenderingApi } from "@/state/viewport-rendering-context";

// CT-352: picking a script for the Custom Script panel is reachable from two
// places - the panel's own "Import script..." button and the Custom Script >
// Import Script... menu item (which opens the panel and picks in one go) - so
// the pick lives here rather than inside the editor component. Picking only
// CONFIGURES the run (no Python executes); Apply runs it.

export type ConfiguredCubeTransformSetter = (next: CubeTransformEditingState | null) => void;

export function buildConfiguredCubeTransformSetterForViewport(
  renderingApi: ViewportRenderingApi,
  viewportIndex: number,
): ConfiguredCubeTransformSetter {
  return (next) => {
    const current = renderingApi.getRenderingState(viewportIndex);
    renderingApi.setRenderingState(viewportIndex, { ...current, cubeTransform: next });
  };
}

export async function pickCustomScriptFileIntoConfiguredTransform(
  setConfiguredTransform: ConfiguredCubeTransformSetter,
): Promise<void> {
  try {
    const picked = await window.toolboxApi.pickUserScriptFile();
    if (picked.canceled) return;
    setConfiguredTransform(buildImportedToolCubeTransformState(picked.filePath, picked.fileName));
  } catch (error) {
    notifyError(error instanceof Error ? error.message : String(error));
  }
}
