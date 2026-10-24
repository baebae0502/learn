import { useEffect, useState, type ReactElement } from 'react';
import { Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';
import { acceleratorLabel } from '@learn/domain';
import { currentPlatform } from './platform';
import { tooltipsBlocked, useTooltipsBlocked } from './tooltipGate';

/**
 * Tooltip content (design-spec 6 툴팁): the name, then one secondary slot — the shortcut in tertiary colour, or, for an
 * icon button disabled with a reason, the reason in secondary colour (the shortcut cannot run then). Also drawn by the
 * state board.
 */
export function TooltipText({ label, accelerator, reason }: { label: string; accelerator?: string | undefined; reason?: string | undefined }) {
  return (
    <>
      <span className="tooltip-label">{label}</span>
      {reason !== undefined ? (
        <span className="tooltip-reason">{reason}</span>
      ) : (
        accelerator && <span className="tooltip-shortcut">{acceleratorLabel(accelerator, currentPlatform())}</span>
      )}
    </>
  );
}

/**
 * Name + shortcut tooltip for icon-only buttons (design-spec 5: "찾기 ⌘F"), and the reason of a control disabled with
 * one (ui/disabledReason.tsx). Opens after 600 ms of hover, at once on keyboard focus; 6 px below the target.
 * Never while the window is inactive or a native menu is open: an open one closes then (Task 8 critique m1).
 */
export function Tooltip({
  label,
  accelerator,
  reason,
  isDisabled,
  forceOpen,
  children,
}: {
  label: string;
  accelerator?: string | undefined;
  /** Disabled reason shown after the name, in place of the shortcut. */
  reason?: string | undefined;
  /** Keep the trigger wrapper (so the child never remounts) but show nothing. */
  isDisabled?: boolean;
  /** Open whatever the hover and focus while true: a short confirmation (복사했습니다). Never while tooltips are blocked. */
  forceOpen?: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const blocked = useTooltipsBlocked();
  const shown = (open || forceOpen === true) && !blocked;
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);
  const onOpenChange = (next: boolean) => {
    if (next && tooltipsBlocked()) return;
    setOpen(next);
  };
  return (
    // Blocked: RAC's trigger is off too, so a focus or hover meanwhile starts nothing in it. A veto alone (below) left
    // its state half-run: a later blur then drew the old tooltip again, for good (Linux evidence, after a quiet focus).
    <TooltipTrigger delay={600} closeDelay={0} isDisabled={isDisabled || blocked} isOpen={shown} onOpenChange={onOpenChange}>
      {children}
      {/* Mounted only while open: closing removes it at once (there is no exit animation), so RAC's exit state can never
          hold a closed tooltip in the page. On the Mac runner one stayed, unseen but counted (t14-diag5: two tooltips
          at m3-10, one of them the sidebar toggle's from an earlier step). */}
      {shown && (
        <AriaTooltip className="tooltip" placement="bottom" offset={6}>
          <TooltipText label={label} accelerator={accelerator} reason={reason} />
        </AriaTooltip>
      )}
    </TooltipTrigger>
  );
}
