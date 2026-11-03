// CT-291: the result-destination control is a two-option segmented control
// ("New panel" / "Replace panel") over the same boolean the CT-277
// switch used to drive. These pure mappers are the single place that
// translates between the two representations.
export type ResultDestination = "new-panel" | "replace-current-panel";

export function resultDestinationFromOpenInNewViewport(openInNewViewport: boolean): ResultDestination {
  return openInNewViewport ? "new-panel" : "replace-current-panel";
}

export function openInNewViewportFromResultDestination(destination: ResultDestination): boolean {
  return destination === "new-panel";
}
