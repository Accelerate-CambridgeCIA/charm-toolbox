import { describe, expect, it } from "vitest";

import {
  formatCommittedValueAsDraft,
  parseTypedNumberOrNull,
  shouldResyncDraftToCommittedValue,
} from "@/lib/forms/numeric-input-draft";

describe("parseTypedNumberOrNull", () => {
  it("returns null for a partial entry the browser reports as empty", () => {
    expect(parseTypedNumberOrNull("")).toBeNull();
    expect(parseTypedNumberOrNull("   ")).toBeNull();
  });

  it("returns null for text that is not a finite number", () => {
    expect(parseTypedNumberOrNull("-")).toBeNull();
    expect(parseTypedNumberOrNull("abc")).toBeNull();
    expect(parseTypedNumberOrNull("Infinity")).toBeNull();
  });

  it("parses a negative bound once the digits follow the sign", () => {
    expect(parseTypedNumberOrNull("-3")).toBe(-3);
    expect(parseTypedNumberOrNull(" -0.5 ")).toBe(-0.5);
  });
});

describe("shouldResyncDraftToCommittedValue", () => {
  it("keeps a mid-entry draft that the browser reports as empty", () => {
    expect(shouldResyncDraftToCommittedValue("", 0)).toBe(false);
  });

  it("keeps a draft that still means the committed value", () => {
    expect(shouldResyncDraftToCommittedValue("1.50", 1.5)).toBe(false);
    expect(shouldResyncDraftToCommittedValue("-3", -3)).toBe(false);
  });

  it("resyncs when the committed value no longer matches the draft", () => {
    expect(shouldResyncDraftToCommittedValue("-3", 0)).toBe(true);
    expect(shouldResyncDraftToCommittedValue("abc", 0)).toBe(true);
  });
});

describe("formatCommittedValueAsDraft", () => {
  it("formats the committed number as plain text", () => {
    expect(formatCommittedValueAsDraft(-3)).toBe("-3");
    expect(formatCommittedValueAsDraft(0.25)).toBe("0.25");
  });
});
