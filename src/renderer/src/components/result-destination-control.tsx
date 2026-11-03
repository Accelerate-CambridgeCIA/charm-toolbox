import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  openInNewViewportFromResultDestination,
  resultDestinationFromOpenInNewViewport,
  type ResultDestination,
} from "@/lib/actions/result-destination";

// CT-291: the shared "Result" segmented control. It replaces the CT-277
// OpenInNewPanelSwitchRow everywhere that switch used to render (the
// tool-options panel footer and the Subset Bands editor).
export interface ResultDestinationControlProps {
  readonly openInNewViewport: boolean;
  readonly onChangeOpenInNewViewport: (next: boolean) => void;
}

export function ResultDestinationControl(props: ResultDestinationControlProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Result</span>
      <ToggleGroup
        type="single"
        variant="outline"
        aria-label="Result"
        className="justify-stretch"
        value={resultDestinationFromOpenInNewViewport(props.openInNewViewport)}
        onValueChange={(next) => onResultDestinationSegmentChosen(next, props.onChangeOpenInNewViewport)}
      >
        <ToggleGroupItem value="new-panel" className="flex-1">
          New panel
        </ToggleGroupItem>
        <ToggleGroupItem value="replace-current-panel" className="flex-1">
          Replace panel
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

// Radix ToggleGroup type="single" reports an empty string when the pressed
// segment is clicked again; ignore it so exactly one option always stays
// selected.
function onResultDestinationSegmentChosen(
  nextValue: string,
  onChangeOpenInNewViewport: (next: boolean) => void,
): void {
  if (nextValue === "") return;
  onChangeOpenInNewViewport(openInNewViewportFromResultDestination(nextValue as ResultDestination));
}
