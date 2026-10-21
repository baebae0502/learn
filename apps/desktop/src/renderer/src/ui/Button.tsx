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
        {button}
      </Tooltip>
      {reason.description}
    </>
  );
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
  /** Why the button can be disabled here: while `isDisabled` the tooltip shows it instead of the name (I1). */
  disabledReason?: string;
}

export function IconButton({ icon, label, accelerator, isOn, size = 'regular', testId, force, disabledReason, ...rest }: IconButtonProps) {
  const reason = useDisabledReason(rest.isDisabled, disabledReason, rest['aria-describedby']);
  return (
    <>
      <Tooltip label={reason.soft ? disabledReason! : label} accelerator={reason.soft ? undefined : accelerator}>
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
