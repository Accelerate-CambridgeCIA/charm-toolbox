import { toast } from "sonner";

import { buildPersistentErrorToastOptions, buildSuccessToastOptions, buildTransientErrorToastOptions } from "./toast-options";

// Error and success toasts are raised only through these functions, so all
// error toasts carry CT-260/CT-347 options. CT-347 distinguishes transient
// errors (30s auto-dismiss) from persistent errors (memory refusals that must
// wait to be read). Info toasts stay on toast.info directly (transient by
// design, no variant options).

export function notifyError(message: string): void {
  toast.error(message, buildTransientErrorToastOptions());
}

export function notifyPersistentError(message: string): void {
  toast.error(message, buildPersistentErrorToastOptions());
}

export function notifySuccess(message: string): void {
  toast.success(message, buildSuccessToastOptions());
}
