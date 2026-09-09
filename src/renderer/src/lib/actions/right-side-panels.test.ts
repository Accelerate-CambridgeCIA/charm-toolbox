import { describe, expect, it, vi } from "vitest";

import {
  closeRightSidePanelsCompetingWith,
  computeRightSidePanelsAfterOpening,
  type RightSidePanelClosers,
  type RightSidePanelId,
} from "./right-side-panels";

const EVERY_PANEL_ID: ReadonlyArray<RightSidePanelId> = ["action", "npc", "cnr", "rop", "masks"];

function buildClosersSpy(): RightSidePanelClosers & { readonly calls: () => string[] } {
  const calls: string[] = [];
  return {
    closeActionPanel: vi.fn(() => void calls.push("action")),
    closeNpcPanel: vi.fn(() => void calls.push("npc")),
    closeCnrPanel: vi.fn(() => void calls.push("cnr")),
    closeRopPanel: vi.fn(() => void calls.push("rop")),
    closeMasksTool: vi.fn(() => void calls.push("masks")),
    calls: () => calls,
  };
}

describe("computeRightSidePanelsAfterOpening", () => {
  for (const opened of EVERY_PANEL_ID) {
    it(`leaves only ${opened} open`, () => {
      const flags = computeRightSidePanelsAfterOpening(opened);
      expect(Object.entries(flags).filter(([, isOpen]) => isOpen)).toEqual([[opened, true]]);
    });
  }
});

describe("closeRightSidePanelsCompetingWith", () => {
  for (const opened of EVERY_PANEL_ID) {
    it(`closes every panel except ${opened}`, () => {
      const closers = buildClosersSpy();
      closeRightSidePanelsCompetingWith(opened, closers);
      expect(closers.calls()).toEqual(EVERY_PANEL_ID.filter((id) => id !== opened));
    });
  }
});
