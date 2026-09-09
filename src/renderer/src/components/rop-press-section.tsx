import { useId } from "react";

import { PANEL_NUMERIC_INPUT_CLASSES } from "@/components/form-control-classes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MAX_ROP_PROJECTIONS_PER_PRESS,
  MIN_ROP_PROJECTIONS_PER_PRESS,
  ROP_PROJECTIONS_PER_PRESS_HINT,
} from "@/lib/analysis/rop-run-request";

// CT-337: one press can draw several projections at once, so browsing thirty
// candidates costs one round trip instead of thirty. The count sits directly
// above the button it governs, and a count the panel cannot use disables the
// press rather than silently falling back to one.

export interface RopPressSectionProps {
  readonly projectionsPerPressText: string;
  readonly onChangeProjectionsPerPressText: (text: string) => void;
  readonly hasUsableProjectionsPerPress: boolean;
  readonly canRollNow: boolean;
  readonly isRolling: boolean;
  readonly onPress: () => void;
}

export function RopPressSection(props: RopPressSectionProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <RopProjectionsPerPressField {...props} />
      <RopNewProjectionButton {...props} />
    </div>
  );
}

function RopProjectionsPerPressField(props: RopPressSectionProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">Projections per press</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={MIN_ROP_PROJECTIONS_PER_PRESS}
            max={MAX_ROP_PROJECTIONS_PER_PRESS}
            step={1}
            aria-label="Projections per press"
            className={PANEL_NUMERIC_INPUT_CLASSES}
            disabled={props.isRolling}
            value={props.projectionsPerPressText}
            onChange={(event) => props.onChangeProjectionsPerPressText(event.target.value)}
          />
        </TooltipTrigger>
        <TooltipContent>{ROP_PROJECTIONS_PER_PRESS_HINT}</TooltipContent>
      </Tooltip>
    </label>
  );
}

function RopNewProjectionButton(props: RopPressSectionProps): JSX.Element {
  const button = (
    <Button type="button" disabled={!props.canRollNow} onClick={props.onPress}>
      {props.isRolling ? "Projecting..." : "New projection"}
    </Button>
  );
  if (props.hasUsableProjectionsPerPress) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{ROP_PROJECTIONS_PER_PRESS_HINT}</TooltipContent>
    </Tooltip>
  );
}
