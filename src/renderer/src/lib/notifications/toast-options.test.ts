import { describe, expect, it } from "vitest";

import { buildPersistentErrorToastOptions, buildSuccessToastOptions, buildTransientErrorToastOptions } from "./toast-options";

describe("buildPersistentErrorToastOptions", () => {
  it("never auto-dismisses: the duration is infinite", () => {
    expect(buildPersistentErrorToastOptions().duration).toBe(Number.POSITIVE_INFINITY);
  });

  it("omits the native close button but provides a Dismiss action", () => {
    expect(buildPersistentErrorToastOptions().closeButton).toBe(false);
    expect(buildPersistentErrorToastOptions().action?.label).toBe("Dismiss");
  });

  it("accepts pointer events despite the Toaster-wide pointer transparency", () => {
    expect(buildPersistentErrorToastOptions().style).toEqual({ pointerEvents: "auto" });
  });
});

describe("buildTransientErrorToastOptions", () => {
  it("auto-dismisses after 30 seconds", () => {
    expect(buildTransientErrorToastOptions().duration).toBe(30000);
  });

  it("omits the native close button but provides a Dismiss action", () => {
    expect(buildTransientErrorToastOptions().closeButton).toBe(false);
    expect(buildTransientErrorToastOptions().action?.label).toBe("Dismiss");
  });

  it("accepts pointer events despite the Toaster-wide pointer transparency", () => {
    expect(buildTransientErrorToastOptions().style).toEqual({ pointerEvents: "auto" });
  });
});

describe("buildSuccessToastOptions", () => {
  it("keeps the transient defaults: no duration, close button, or style overrides", () => {
    expect(buildSuccessToastOptions()).toEqual({});
  });
});
