import type { ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { useDisabledReason, withoutPresses } from './disabledReason';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

/** Gallery only: draw a state without interacting (CSS reads [data-force~=…] next to RAC's data attributes). */
export type ForcedState = 'hover' | 'pressed' | 'focus' | 'on' | 'active' | 'selected' | 'focused' | 'cursor';
export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'plain-accent' | 'plain-danger';

type Base = Omit<AriaButtonProps, 'className' | 'children' | 'style'>;

export interface ButtonProps extends Base {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'small' | 'regular' | 'large';
  icon?: LucideIcon;
  /** Plain button whose label lines up with the text column (sheet footers, design-spec 6 버튼). */
  leading?: boolean;
  testId?: string;
  force?: ForcedState[];
  /**
   * Why the button can be disabled here. While `isDisabled`, the button stays focusable (aria-disabled) and shows
   * this as its tooltip and description; it is never part of the label (ui/disabledReason.tsx).
   */
  disabledReason?: string;
}

export function Button({ children, variant = 'secondary', size = 'regular', icon, leading, testId, force, disabledReason, ...rest }: ButtonProps) {
  const reason = useDisabledReason(rest.isDisabled, disabledReason, rest['aria-describedby']);
  const button = (
    <AriaButton
      {...withoutPresses(rest, reason.soft)}
      {...reason.controlProps}
      className={cx('btn', `btn-${variant}`, size !== 'regular' && `btn-${size}`, icon && 'has-icon', leading && 'leading')}
      data-testid={testId}
      data-force={force?.join(' ')}
    >
      {icon && <Icon icon={icon} size={size === 'small' ? 'sm' : 'md'} />}
      {children}
    </AriaButton>
  );
  if (disabledReason === undefined) return button;
  return (
    <>
      <Tooltip label={disabledReason} isDisabled={!reason.soft}>
        <SoftDisabled>{button}</SoftDisabled>
      </Tooltip>
      {reason.description}
    </>
  );
}

/**
 * Box of a button that has a disabled reason (always present for such a call site, so the tree never changes). While
 * the button is soft-disabled and keyboard-focused, the wrapper draws the focus ring outside the dimmed button: the
 * ring keeps full opacity and 3:1 (design-spec 8.3). The RAC trigger contexts (tooltip, menu) pass through it.
 */
export function SoftDisabled({ children }: { children: ReactNode }) {
  return <span className="soft-disabled">{children}</span>;
}

export interface IconButtonProps extends Omit<Base, 'aria-label'> {
  icon: LucideIcon;
  /** Accessible name and tooltip text. */
  label: string;
  /** Electron accelerator from the command registry, shown in the tooltip. */
  accelerator?: string;
  /** Toggle drawn "on" (--fill-pressed + primary text). */
  isOn?: boolean;
  size?: 'regular' | 'small';
  testId?: string;
  force?: ForcedState[];
  /** Why the button can be disabled here: while `isDisabled` the tooltip shows it after the name, instead of the shortcut (I1). */
  disabledReason?: string;
  /** Show the tooltip now, whatever the pointer (with a label that confirms what just happened). */
  tooltipOpen?: boolean;
}

export function IconButton({ icon, label, accelerator, isOn, size = 'regular', testId, force, disabledReason, tooltipOpen, ...rest }: IconButtonProps) {
  const reason = useDisabledReason(rest.isDisabled, disabledReason, rest['aria-describedby']);
  return (
    <>
      <Tooltip label={label} accelerator={accelerator} reason={reason.soft ? disabledReason : undefined} forceOpen={tooltipOpen}>
        <AriaButton
          {...withoutPresses(rest, reason.soft)}
          {...reason.controlProps}
          aria-label={label}
          className={cx('icon-btn', size === 'small' && 'sm')}
          data-on={isOn ? '' : undefined}
          data-testid={testId}
          data-force={force?.join(' ')}
        >
          <Icon icon={icon} size={size === 'small' ? 'sm' : 'md'} />
        </AriaButton>
      </Tooltip>
      {reason.description}
    </>
  );
}
