import type { ReactElement } from 'react';
import { Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';
import { acceleratorLabel } from '@learn/domain';
import { currentPlatform } from './platform';

/** Tooltip content: the name, then the shortcut in tertiary colour (design-spec 6 툴팁). Also drawn by the state board. */
export function TooltipText({ label, accelerator }: { label: string; accelerator?: string | undefined }) {
  return (
    <>
      {label}
      {accelerator && <span className="tooltip-shortcut">{acceleratorLabel(accelerator, currentPlatform())}</span>}
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
  isDisabled,
  children,
}: {
  label: string;
  accelerator?: string | undefined;
  /** Keep the trigger wrapper (so the child never remounts) but show nothing. */
  isDisabled?: boolean;
  children: ReactElement;
}) {
  return (
    <TooltipTrigger delay={600} closeDelay={0} isDisabled={isDisabled}>
      {children}
      <AriaTooltip className="tooltip" placement="bottom" offset={6}>
        <TooltipText label={label} accelerator={accelerator} />
      </AriaTooltip>
    </TooltipTrigger>
  );
}
