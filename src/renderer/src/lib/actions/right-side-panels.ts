// CT-345: the operation panel, the NPC / CNR / ROP asides and the Masks
// options aside all compete for the same right-side slot, so opening any one
// of them closes every other one instead of stacking them out of sight.

export type RightSidePanelId = "action" | "npc" | "cnr" | "rop" | "masks";

export interface RightSidePanelOpenFlags {
  readonly action: boolean;
  readonly npc: boolean;
  readonly cnr: boolean;
  readonly rop: boolean;
  readonly masks: boolean;
}

export interface RightSidePanelClosers {
  readonly closeActionPanel: () => void;
  readonly closeNpcPanel: () => void;
  readonly closeCnrPanel: () => void;
  readonly closeRopPanel: () => void;
  readonly closeMasksTool: () => void;
}

export function computeRightSidePanelsAfterOpening(
  opened: RightSidePanelId,
): RightSidePanelOpenFlags {
  return {
    action: opened === "action",
    npc: opened === "npc",
    cnr: opened === "cnr",
    rop: opened === "rop",
    masks: opened === "masks",
  };
}

export function closeRightSidePanelsCompetingWith(
  opened: RightSidePanelId,
  closers: RightSidePanelClosers,
): void {
  const flags = computeRightSidePanelsAfterOpening(opened);
  if (!flags.action) closers.closeActionPanel();
  if (!flags.npc) closers.closeNpcPanel();
  if (!flags.cnr) closers.closeCnrPanel();
  if (!flags.rop) closers.closeRopPanel();
  if (!flags.masks) closers.closeMasksTool();
}
