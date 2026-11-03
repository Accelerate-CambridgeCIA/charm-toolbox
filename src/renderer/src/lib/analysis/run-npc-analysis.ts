import {
  validatePerBandNumberListReturnValue,
  type PerBandNumberListSubject,
} from "@/lib/image/band-ops/user-script-return-contract";
import { isOperationStoppedError } from "@/lib/image/operation-stop";
import type { RasterImage } from "@/lib/image/raster-image";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import {
  runUserScriptOnRasterShowingViewportBusy,
  type UserScriptRunFlowBindings,
} from "@/lib/python/run-user-script-flow";
import type { UserScriptRunChunkedApi } from "@/lib/python/run-user-script-chunked";

import { buildNpcRunExtras } from "./npc-run-request";

// CT-308: runs the packaged npc.py over the active stack and its chosen mask
// layer. NPC produces a SCORE, not a raster, so this never touches the apply
// flow: it streams the cube through the CT-307 built-in run protocol, shows the
// panel's busy entry with a working Stop, and hands the scores back.
//
// CT-318: npc.py scores every band ON ITS OWN, so a run returns one score per
// band (index = band index) rather than one pooled number.

export type NpcAnalysisOutcome =
  | { readonly status: "computed"; readonly scores: ReadonlyArray<number> }
  | { readonly status: "stopped" }
  | { readonly status: "failed"; readonly message: string };

export interface NpcAnalysisRequest {
  readonly raster: RasterImage;
  readonly maskLayer: MaskLayer;
  readonly bins: number;
}

const NPC_BUILTIN_SOURCE: ToolboxRunUserScriptSource = {
  mode: "builtin",
  scriptName: "npc",
};

const NPC_RETURNED_NO_SCORE =
  "The Potential Contrast analysis did not return a score. Please report this as a bug.";

const NPC_SCORE_LIST_SUBJECT: PerBandNumberListSubject = {
  listName: "The Potential Contrast score list",
  elementName: "Potential Contrast score",
  onePerBandPhrase: "one Potential Contrast score per band",
};

export async function computeNpcScoreShowingPanelBusy(
  request: NpcAnalysisRequest,
  bindings: UserScriptRunFlowBindings,
  api?: UserScriptRunChunkedApi,
): Promise<NpcAnalysisOutcome> {
  try {
    const result = await runUserScriptOnRasterShowingViewportBusy(
      { ...bindings, extras: buildNpcRunExtras(request.maskLayer, request.bins) },
      request.raster,
      NPC_BUILTIN_SOURCE,
      "value",
      api ?? window.toolboxApi,
    );
    return describeNpcRunOutcome(result, request.raster.bandCount);
  } catch (error) {
    return describeNpcRunFailureOutcome(error);
  }
}

function describeNpcRunOutcome(
  result: ToolboxRunUserScriptResult,
  bandCount: number,
): NpcAnalysisOutcome {
  if (result.status === "completed") return describeCompletedNpcRun(result.value, bandCount);
  if (result.status === "canceled") return { status: "stopped" };
  if (result.status === "failed") return { status: "failed", message: result.message };
  return { status: "failed", message: NPC_RETURNED_NO_SCORE };
}

function describeCompletedNpcRun(value: unknown, bandCount: number): NpcAnalysisOutcome {
  try {
    const scores = validatePerBandNumberListReturnValue(value, bandCount, NPC_SCORE_LIST_SUBJECT);
    return { status: "computed", scores };
  } catch (error) {
    return { status: "failed", message: describeInvalidNpcResult(error) };
  }
}

function describeInvalidNpcResult(error: unknown): string {
  return error instanceof Error ? error.message : NPC_RETURNED_NO_SCORE;
}

function describeNpcRunFailureOutcome(error: unknown): NpcAnalysisOutcome {
  if (isOperationStoppedError(error)) return { status: "stopped" };
  return { status: "failed", message: describeElectronInvokeFailure(error) };
}
