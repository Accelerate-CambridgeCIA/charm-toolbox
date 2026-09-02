import { useId } from "react";

import { PANEL_NUMERIC_INPUT_CLASSES } from "@/components/form-control-classes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MIN_ROP_SEARCH_PROJECTION_COUNT } from "@/lib/analysis/rop-search-request";

// CT-310: the ROP panel's search section. Where New projection shows one
// candidate, Search runs the whole draw in Python and keeps only the winner, so
// it only makes sense with something to maximize: without an objective the
// field and the button are disabled and the panel says why.

export const ROP_SEARCH_NEEDS_AN_OBJECTIVE =
  "Choose an objective to search for the best projection.";

// CT-330: a search that could not land its winner anywhere would otherwise
// run to completion and then discard the result, so the button refuses the
// press up front - same shape as the New projection refusal, but stated
// here (a tooltip) instead of a toast because nothing has been attempted yet.
export const ROP_SEARCH_NEEDS_A_FREE_PANEL_TOOLTIP =
  "Every panel is in use. Close a panel before searching.";

export interface RopSearchSectionProps {
  readonly projectionCountText: string;
  readonly onChangeProjectionCountText: (text: string) => void;
  readonly isObjectiveChosen: boolean;
  readonly canSearchNow: boolean;
  readonly isSearching: boolean;
  readonly onSearch: () => void;
  readonly deliveryRefusesEveryPanel: boolean;
}

export function RopSearchSection(props: RopSearchSectionProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <span className="text-xs font-medium text-muted-foreground">Search projections</span>
      <RopProjectionCountField {...props} />
      <RopSearchButton {...props} />
      {props.isObjectiveChosen ? null : (
        <p className="text-xs text-muted-foreground">{ROP_SEARCH_NEEDS_AN_OBJECTIVE}</p>
      )}
    </div>
  );
}

function RopProjectionCountField(props: RopSearchSectionProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">Projections</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={MIN_ROP_SEARCH_PROJECTION_COUNT}
        step={1}
        aria-label="Projections"
        className={PANEL_NUMERIC_INPUT_CLASSES}
        disabled={!props.isObjectiveChosen || props.isSearching}
        value={props.projectionCountText}
        onChange={(event) => props.onChangeProjectionCountText(event.target.value)}
      />
    </label>
  );
}

// The delivery refusal is marked with aria-disabled, not the native `disabled`
// attribute: the click must still reach onSearch so its own copy of the
// pre-check (checkRopRunCanDeliverSomewhere) is what raises the refusal toast,
// exactly like a New projection press. A native `disabled` button would block
// the click at the browser level and the search would just look inert.
function RopSearchButton(props: RopSearchSectionProps): JSX.Element {
  const refusesDelivery = props.canSearchNow && props.deliveryRefusesEveryPanel;
  const button = (
    <Button
      type="button"
      disabled={!props.canSearchNow}
      aria-disabled={refusesDelivery || undefined}
      className={refusesDelivery ? "pointer-events-auto opacity-50" : undefined}
      onClick={props.onSearch}
    >
      {props.isSearching ? "Searching..." : "Search"}
    </Button>
  );
  if (!refusesDelivery) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{ROP_SEARCH_NEEDS_A_FREE_PANEL_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}
