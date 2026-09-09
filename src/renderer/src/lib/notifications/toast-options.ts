import type { CSSProperties } from "react";

// CT-260/CT-347: error toasts must not trap the user. CT-260 memory-refusal
// toasts persist indefinitely (the user must read "close panel X"), while
// CT-347 non-memory errors auto-dismiss after 30 seconds so they never look
// stuck. Both omit the native close button and supply a custom Dismiss action
// instead. The Toaster makes every toast pointer-transparent by default
// (components/ui/sonner.tsx) so transient toasts cannot block the panel under
// them; error toasts opt back in to pointer events per-toast, because their
// Dismiss button has to be hoverable and clickable. Success and info toasts
// keep the transient auto-dismissing defaults.

export interface ToastVariantOptions {
  readonly duration?: number;
  readonly closeButton?: boolean;
  readonly style?: CSSProperties;
  readonly action?: { label: string; onClick: () => void };
}

// Sonner calls this action's onClick and then, unless the event was
// prevented, dismisses THIS toast itself (its action button handler already
// closes over the toast's own id) - so the action needs no dismiss call of
// its own. A single shared no-op keeps every call to the builders below
// referentially equal, which is what lets tests assert on the built options.
function noOpDismissAction(): void {}

const DISMISS_ERROR_TOAST_ACTION = { label: "Dismiss", onClick: noOpDismissAction };

export function buildPersistentErrorToastOptions(): ToastVariantOptions {
  return {
    duration: Number.POSITIVE_INFINITY,
    closeButton: false,
    style: { pointerEvents: "auto" },
    action: DISMISS_ERROR_TOAST_ACTION,
  };
}

export function buildTransientErrorToastOptions(): ToastVariantOptions {
  return {
    duration: 30000,
    closeButton: false,
    style: { pointerEvents: "auto" },
    action: DISMISS_ERROR_TOAST_ACTION,
  };
}

export function buildSuccessToastOptions(): ToastVariantOptions {
  return {};
}
