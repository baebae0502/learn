import type { ReactElement } from 'react';
import { Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';
import { acceleratorLabel } from '@learn/domain';
import { currentPlatform } from './platform';

/**
 * Tooltip content (design-spec 6 툴팁): the name, then one secondary slot — the shortcut in tertiary colour, or, for an
 * icon button disabled with a reason, the reason in secondary colour (the shortcut cannot run then). Also drawn by the
 * state board.
 */
export function TooltipText({ label, accelerator, reason }: { label: string; accelerator?: string | undefined; reason?: string | undefined }) {
  return (
    <>
      {label}
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
 */
export function Tooltip({
  label,
  accelerator,
  reason,
  isDisabled,
  children,
}: {
  label: string;
  accelerator?: string | undefined;
  /** Disabled reason shown after the name, in place of the shortcut. */
  reason?: string | undefined;
  /** Keep the trigger wrapper (so the child never remounts) but show nothing. */
  isDisabled?: boolean;
  children: ReactElement;
}) {
  return (
    <TooltipTrigger delay={600} closeDelay={0} isDisabled={isDisabled}>
      {children}
      <AriaTooltip className="tooltip" placement="bottom" offset={6}>
        <TooltipText label={label} accelerator={accelerator} reason={reason} />
      </AriaTooltip>
    </TooltipTrigger>
  );
}
