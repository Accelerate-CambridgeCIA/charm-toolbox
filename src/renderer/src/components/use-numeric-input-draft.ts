import { useEffect, useRef, useState } from "react";

import {
  formatCommittedValueAsDraft,
  parseTypedNumberOrNull,
  shouldResyncDraftToCommittedValue,
} from "@/lib/forms/numeric-input-draft";

// Owns the text a numeric field shows while the user types (CT-350). The
// committed number lives with the caller; the draft only follows it when the
// committed value moves away from what the draft means, and on blur the draft
// settles on whatever the caller actually accepted (a clamped value, say).

export interface NumericInputDraft {
  readonly draft: string;
  readonly onChangeRawValue: (rawValue: string) => void;
  readonly onBlur: () => void;
}

export function useNumericInputDraft(
  committedValue: number,
  onCommitValue: (next: number) => void,
): NumericInputDraft {
  const [draft, setDraft] = useState(() => formatCommittedValueAsDraft(committedValue));
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  useEffect(() => {
    if (shouldResyncDraftToCommittedValue(latestDraft.current, committedValue)) {
      setDraft(formatCommittedValueAsDraft(committedValue));
    }
  }, [committedValue]);
  return {
    draft,
    onChangeRawValue: (rawValue) => commitDraftIfNumeric(rawValue, setDraft, onCommitValue),
    onBlur: () => setDraft(formatCommittedValueAsDraft(committedValue)),
  };
}

function commitDraftIfNumeric(
  rawValue: string,
  setDraft: (next: string) => void,
  onCommitValue: (next: number) => void,
): void {
  setDraft(rawValue);
  const parsed = parseTypedNumberOrNull(rawValue);
  if (parsed !== null) onCommitValue(parsed);
}
