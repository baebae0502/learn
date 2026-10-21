import type { ReactElement } from 'react';
import { Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';
import { acceleratorLabel } from '@learn/domain';
import { currentPlatform } from './platform';

/** Name + shortcut tooltip for icon-only buttons (design-spec 5: "찾기 ⌘F"). Shown on hover and keyboard focus. */
export function Tooltip({ label, accelerator, children }: { label: string; accelerator?: string; children: ReactElement }) {
  return (
    <TooltipTrigger delay={600} closeDelay={0}>
      {children}
      <AriaTooltip className="tooltip" placement="bottom" offset={6}>
        {label}
        {accelerator && <span className="tooltip-shortcut">{acceleratorLabel(accelerator, currentPlatform())}</span>}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
