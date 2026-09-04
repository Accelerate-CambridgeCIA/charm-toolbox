import type { CSSProperties } from "react";
import { toast } from "sonner";

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
  readonly action?: { label: string; onClick: (toast: any) => void };
}

function buildErrorToastActionWithDismiss(): { label: string; onClick: (toast: any) => void } {
  return {
    label: "Dismiss",
    onClick: (toast: any) => {
      toast.dismiss(toast.id);
    },
  };
}

export function buildPersistentErrorToastOptions(): ToastVariantOptions {
  return {
    duration: Number.POSITIVE_INFINITY,
    closeButton: false,
    style: { pointerEvents: "auto" },
    action: buildErrorToastActionWithDismiss(),
  };
}

export function buildTransientErrorToastOptions(): ToastVariantOptions {
  return {
    duration: 30000,
    closeButton: false,
    style: { pointerEvents: "auto" },
    action: buildErrorToastActionWithDismiss(),
  };
}

export function buildSuccessToastOptions(): ToastVariantOptions {
  return {};
}
