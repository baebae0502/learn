import { ChevronDown, type LucideIcon } from 'lucide-react';
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { acceleratorLabel } from '@learn/domain';
import { DisabledReason } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import { currentPlatform } from './platform';

export interface MenuButtonItem<K extends string> {
  id: K;
  label: string;
  accelerator?: string;
  testId?: string;
  isDisabled?: boolean;
}

/** Web pop-up button menu: only for buttons inside the content (design-spec 6 메뉴, 7.3). */
export function MenuButton<K extends string>(props: {
  label: string;
  icon?: LucideIcon;
  items: readonly MenuButtonItem<K>[];
  onAction(id: K): void;
  isDisabled?: boolean;
  /** Tooltip while the whole button is disabled (M-2, see DisabledReason). */
  disabledReason?: string;
  testId?: string;
}) {
  const platform = currentPlatform();
  const trigger = (
    <MenuTrigger>
      <AriaButton className={cx('btn', 'btn-secondary', props.icon && 'has-icon', 'has-menu')} isDisabled={props.isDisabled} data-testid={props.testId}>
        {props.icon && <Icon icon={props.icon} />}
        {props.label}
        <Icon icon={ChevronDown} size="xs" />
      </AriaButton>
      <Popover className="menu-popover" placement="bottom start" offset={4}>
        <Menu className="menu" onAction={(key) => props.onAction(String(key) as K)} disabledKeys={props.items.filter((i) => i.isDisabled).map((i) => i.id)}>
          {props.items.map((item) => (
            <MenuItem key={item.id} id={item.id} textValue={item.label} className="mi" data-testid={item.testId}>
              <span className="check" aria-hidden="true" />
              <span className="mi-label">{item.label}</span>
              {item.accelerator && <span className="shortcut">{acceleratorLabel(item.accelerator, platform)}</span>}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
  if (props.disabledReason === undefined) return trigger;
  return (
    <DisabledReason reason={props.isDisabled ? props.disabledReason : undefined} testId={props.testId}>
      {trigger}
    </DisabledReason>
  );
}
