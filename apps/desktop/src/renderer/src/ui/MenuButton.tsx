import { useState, type CSSProperties } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { Button as AriaButton, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Separator } from 'react-aria-components';
import { acceleratorLabel } from '@learn/domain';
import { IconButton, SoftDisabled, type ForcedState } from './Button';
import { cx } from './cx';
import { useDisabledReason } from './disabledReason';
import { Icon } from './Icon';
import { currentPlatform } from './platform';
import { Tooltip } from './Tooltip';

export interface MenuButtonItem<K extends string> {
  id: K;
  label: string;
  accelerator?: string;
  testId?: string;
  isDisabled?: boolean;
  /**
   * The current choice of its group: a 14 px check in the check column. A group (section, or the top level) with any
   * item that sets `checked` is a single-choice group (menuitemradio + aria-checked); the caller owns the choice and
   * updates it from `onAction`.
   */
  checked?: boolean;
  /** State board only. */
  force?: ForcedState[];
}
export interface MenuButtonSection<K extends string> {
  /** Caption header above the items (design-spec 6 메뉴); omit for an unlabelled group. */
  header?: string;
  items: readonly MenuButtonItem<K>[];
}
export interface MenuSeparator {
  separator: true;
}
export const MENU_SEPARATOR: MenuSeparator = { separator: true };
export type MenuEntry<K extends string> = MenuButtonItem<K> | MenuButtonSection<K> | MenuSeparator;

const isSeparator = <K extends string>(e: MenuEntry<K>): e is MenuSeparator => 'separator' in e;
const isSection = <K extends string>(e: MenuEntry<K>): e is MenuButtonSection<K> => 'items' in e;

/** Single-choice selection props for a group whose items carry `checked`; none otherwise. */
function choice<K extends string>(items: readonly MenuButtonItem<K>[]) {
  if (!items.some((i) => i.checked !== undefined)) return { selectionMode: 'none' as const };
  return { selectionMode: 'single' as const, selectedKeys: items.filter((i) => i.checked).map((i) => i.id), onSelectionChange: () => {} };
}

function Item<K extends string>({ item, platform }: { item: MenuButtonItem<K>; platform: string }) {
  return (
    <MenuItem id={item.id} textValue={item.label} className="mi" isDisabled={item.isDisabled} data-testid={item.testId} data-force={item.force?.join(' ')}>
      <span className="check" aria-hidden="true">
        {item.checked && <Icon icon={Check} size="sm" />}
      </span>
      <span className="mi-label">{item.label}</span>
      {item.accelerator && <span className="shortcut">{acceleratorLabel(item.accelerator, platform)}</span>}
    </MenuItem>
  );
}

/**
 * The web menu itself (design-spec 6 메뉴, 7.3): items with a check column and right-aligned shortcuts, caption
 * section headers and separators. MenuButton shows it in a popover; the state board draws it in place.
 */
export function MenuList<K extends string>(props: {
  entries: readonly MenuEntry<K>[];
  onAction(id: K): void;
  'aria-label'?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  const platform = currentPlatform();
  const topItems = props.entries.filter((e): e is MenuButtonItem<K> => !isSeparator(e) && !isSection(e));
  return (
    <Menu
      className="menu"
      aria-label={props['aria-label']}
      style={props.style}
      data-testid={props.testId}
      onAction={(key) => props.onAction(String(key) as K)}
      {...choice(topItems)}
    >
      {props.entries.map((entry, i) => {
        if (isSeparator(entry)) return <Separator key={`sep-${i}`} className="msep" />;
        if (isSection(entry)) {
          return (
            <MenuSection key={`sec-${i}`} id={`sec-${i}`} {...choice(entry.items)}>
              {entry.header && <Header className="mhead">{entry.header}</Header>}
              {entry.items.map((item) => (
                <Item key={item.id} item={item} platform={platform} />
              ))}
            </MenuSection>
          );
        }
        return <Item key={entry.id} item={entry} platform={platform} />;
      })}
    </Menu>
  );
}

/** Web pop-up button menu: only for buttons inside the content (design-spec 6 메뉴, 7.3): label + 12 px chevron. */
export function MenuButton<K extends string>(props: {
  label: string;
  icon?: LucideIcon;
  items: readonly MenuEntry<K>[];
  onAction(id: K): void;
  isDisabled?: boolean;
  /** Why it can be disabled here: while `isDisabled` the button stays focusable but never opens (I1, ui/disabledReason). */
  disabledReason?: string;
  /** Which edge the menu lines up with: the button's start (default) or, for a button at the window's end, its end. */
  placement?: 'bottom start' | 'bottom end';
  testId?: string;
}) {
  const reason = useDisabledReason(props.isDisabled, props.disabledReason);
  // Controlled, so a soft-disabled trigger (focusable, aria-disabled) can never open the menu.
  const [isOpen, setOpen] = useState(false);
  const trigger = (
    <AriaButton className={cx('btn', 'btn-secondary', props.icon && 'has-icon', 'has-menu')} {...reason.controlProps} data-testid={props.testId}>
      {props.icon && <Icon icon={props.icon} />}
      {props.label}
      <Icon icon={ChevronDown} size="xs" />
    </AriaButton>
  );
  return (
    <>
      <MenuTrigger isOpen={isOpen && !reason.soft} onOpenChange={(open) => setOpen(open && !reason.soft)}>
        {props.disabledReason === undefined ? (
          trigger
        ) : (
          <Tooltip label={props.disabledReason} isDisabled={!reason.soft}>
            <SoftDisabled>{trigger}</SoftDisabled>
          </Tooltip>
        )}
        <Popover className="menu-popover" placement={props.placement ?? 'bottom start'} offset={4}>
          <MenuList entries={props.items} onAction={props.onAction} />
        </Popover>
      </MenuTrigger>
      {reason.description}
    </>
  );
}

/**
 * The "…" button of a web pop-up menu (design-spec 7.3 태그 선택기): an icon-only trigger with a tooltip, the same menu
 * (MenuList) in the same popover. For a button inside the content that has no room for a label.
 */
export function MenuIconButton<K extends string>(props: {
  label: string;
  icon: LucideIcon;
  items: readonly MenuEntry<K>[];
  onAction(id: K): void;
  placement?: 'bottom start' | 'bottom end';
  size?: 'regular' | 'small';
  testId?: string;
}) {
  return (
    <MenuTrigger>
      <IconButton icon={props.icon} label={props.label} size={props.size ?? 'small'} testId={props.testId} />
      <Popover className="menu-popover" placement={props.placement ?? 'bottom end'} offset={4}>
        <MenuList entries={props.items} onAction={props.onAction} aria-label={props.label} />
      </Popover>
    </MenuTrigger>
  );
}
