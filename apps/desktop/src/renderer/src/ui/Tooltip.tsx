import { useEffect, useState, type ReactElement, type RefObject } from 'react';
import { Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';
import { acceleratorLabel } from '@learn/domain';
import { currentPlatform } from './platform';
import { tooltipsBlocked, useTooltipsBlocked } from './tooltipGate';

/**
 * Tooltip content (design-spec 6 툴팁): the name, then one secondary slot — the shortcut in tertiary colour, or, for an
 * icon button disabled with a reason, the reason in secondary colour (the shortcut cannot run then). Also drawn by the
 * state board. `note`: a second line under the name, in secondary colour (the attached passage cut to its first page).
 */
export function TooltipText({ label, accelerator, keys, reason, note }: { label: string; accelerator?: string | undefined; keys?: string | undefined; reason?: string | undefined; note?: string | undefined }) {
  return (
    <>
      <span className="tooltip-label">{label}</span>
      {note !== undefined ? (
        <span className="tooltip-note">{note}</span>
      ) : reason !== undefined ? (
        <span className="tooltip-reason">{reason}</span>
      ) : (
        (keys ?? accelerator) && <span className="tooltip-shortcut">{keys ?? acceleratorLabel(accelerator!, currentPlatform())}</span>
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
  keys,
  reason,
  note,
  placement = 'bottom',
  anchorRef,
  isDisabled,
  forceOpen,
  children,
}: {
  label: string;
  accelerator?: string | undefined;
  /** The shortcut as text when it is a single key or two ("K · 스페이스"), which an accelerator cannot say. */
  keys?: string | undefined;
  /** Disabled reason shown after the name, in place of the shortcut. */
  reason?: string | undefined;
  /** A second line under the name (the tooltip then stacks). */
  note?: string | undefined;
  /**
   * Above the target, for one at the window's bottom whose tooltip would cover what follows it (the composer's chip); `top end` ends it
   * at the anchor's right edge (a control at the end of a chip anchored on the chip).
   */
  placement?: 'bottom' | 'top' | 'top end';
  /** The box the tooltip stands off from and centres on, when it is not the trigger itself (a part of a chip: the chip). */
  anchorRef?: RefObject<Element | null>;
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
        <AriaTooltip className={note === undefined ? 'tooltip' : 'tooltip has-note'} placement={placement} offset={6} {...(anchorRef ? { triggerRef: anchorRef } : {})}>
          <TooltipText label={label} accelerator={accelerator} keys={keys} reason={reason} note={note} />
        </AriaTooltip>
      )}
    </TooltipTrigger>
  );
}
