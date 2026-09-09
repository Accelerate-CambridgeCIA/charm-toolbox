// A controlled <input type="number"> reports "" for a partial entry such as "-"
// or "1e", and the field used to answer by rewriting the box with its last
// committed number, so a leading minus sign could never be typed (CT-350).
// The field now keeps the typed text as a draft and commits a number only when
// the draft parses as finite; these are the pure rules behind that draft.

export function parseTypedNumberOrNull(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCommittedValueAsDraft(value: number): string {
  return String(value);
}

// Resync the draft when the committed value moved away from what the draft
// says (an external reset, a clamp), but never while the draft still means the
// committed value ("1.50" for 1.5) or is mid-entry ("-" reports as "").
export function shouldResyncDraftToCommittedValue(draft: string, committedValue: number): boolean {
  const draftValue = parseTypedNumberOrNull(draft);
  if (draftValue === null) return draft.trim() !== "";
  return draftValue !== committedValue;
}
