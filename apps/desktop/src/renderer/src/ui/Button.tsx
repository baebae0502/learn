import type { ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

/** Gallery only: draw a state without interacting (CSS reads [data-force~=…] next to RAC's data attributes). */
export type ForcedState = 'hover' | 'pressed' | 'focus' | 'on' | 'active' | 'selected' | 'focused' | 'cursor';
export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'plain-accent' | 'plain-danger';

type Base = Omit<AriaButtonProps, 'className' | 'children' | 'style'>;

/**
 * design-spec 6 "비활성 이유는 툴팁으로 알리고 레이블에 넣지 않는다" (M-2). RAC tooltips never open on a disabled
 * trigger, so the reason is the native tooltip (`title`) of a box-less wrapper (`display: contents`). A call site that
 * passes a reason always gets the wrapper, so toggling `isDisabled` never remounts (and blurs) the control.
 */
export function DisabledReason({ reason, testId, children }: { reason: string | undefined; testId?: string; children: ReactNode }) {
  return (
    <span className="disabled-reason" title={reason} data-testid={testId ? `${testId}-reason` : undefined}>
      {children}
    </span>
  );
}

export interface ButtonProps extends Base {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'small' | 'regular' | 'large';
  icon?: LucideIcon;
  /** Plain button whose label lines up with the text column (sheet footers, design-spec 6 버튼). */
  leading?: boolean;
  testId?: string;
  force?: ForcedState[];
  /** Why the button can be disabled here: its tooltip while `isDisabled` (never part of the label). */
  disabledReason?: string;
}

export function Button({ children, variant = 'secondary', size = 'regular', icon, leading, testId, force, disabledReason, ...rest }: ButtonProps) {
  const button = (
    <AriaButton
      {...rest}
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
    <DisabledReason reason={rest.isDisabled ? disabledReason : undefined} testId={testId}>
      {button}
    </DisabledReason>
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
  /** Why the button can be disabled here: the tooltip while `isDisabled` (the RAC name tooltip cannot open then). */
  disabledReason?: string;
}

export function IconButton({ icon, label, accelerator, isOn, size = 'regular', testId, force, disabledReason, ...rest }: IconButtonProps) {
  const button = (
    <Tooltip label={label} accelerator={accelerator}>
      <AriaButton
        {...rest}
        aria-label={label}
        className={cx('icon-btn', size === 'small' && 'sm')}
        data-on={isOn ? '' : undefined}
        data-testid={testId}
        data-force={force?.join(' ')}
      >
        <Icon icon={icon} size={size === 'small' ? 'sm' : 'md'} />
      </AriaButton>
    </Tooltip>
  );
  if (disabledReason === undefined) return button;
  return (
    <DisabledReason reason={rest.isDisabled ? disabledReason : undefined} testId={testId}>
      {button}
    </DisabledReason>
  );
}
