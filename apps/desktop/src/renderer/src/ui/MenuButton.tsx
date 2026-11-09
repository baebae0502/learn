import { useState, type CSSProperties, type RefObject } from 'react';
import { Check, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { Button as AriaButton, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Separator, SubmenuTrigger, Text } from 'react-aria-components';
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
  /**
   * A mark that is the item's own state, not the group's one answer: a check in the check column (a collection that
   * already holds the selection). A group with any `marked` item is a multiple-selection group (menuitemcheckbox +
   * aria-checked); not mixed with `checked` in one group.
   */
  marked?: boolean;
  /** Level in a tree list: the label is indented 16 px a level, as the sidebar tree steps. */
  indent?: number;
  /** A second line under the label, in the secondary colour: what the choice covers (the search scope's fields). */
  description?: string;
  /**
   * A line that tells, not an action (the body index's progress): it cannot be chosen or focused, and reads in the
   * secondary colour rather than as a disabled action.
   */
  info?: boolean;
  /** State board only. */
  force?: ForcedState[];
}
export interface MenuButtonSection<K extends string> {
  /** Caption header above the items (design-spec 6 메뉴); omit for an unlabelled group. */
  header?: string;
  items: readonly MenuButtonItem<K>[];
}
/**
 * A row that opens a fly-out menu of its own (design-spec 6 메뉴: 보기 ▾'s 스크롤 and 펼침): a name with a ▸ at the right, whose items
 * are one single-choice group when any of them sets `checked`. `isDisabled` greys the row and keeps it from opening.
 */
export interface MenuSubmenu<K extends string> {
  /** The row's own key (never an action: choosing the row opens it). */
  id: string;
  submenu: true;
  label: string;
  items: readonly MenuButtonItem<K>[];
  isDisabled?: boolean;
  testId?: string;
}
export interface MenuSeparator {
  separator: true;
}
export const MENU_SEPARATOR: MenuSeparator = { separator: true };
export type MenuEntry<K extends string> = MenuButtonItem<K> | MenuButtonSection<K> | MenuSubmenu<K> | MenuSeparator;

const isSeparator = <K extends string>(e: MenuEntry<K>): e is MenuSeparator => 'separator' in e;
const isSubmenu = <K extends string>(e: MenuEntry<K>): e is MenuSubmenu<K> => 'submenu' in e;
const isSection = <K extends string>(e: MenuEntry<K>): e is MenuButtonSection<K> => 'items' in e && !('submenu' in e);

/** Selection props for a group whose items carry `checked` (one answer) or `marked` (each its own); none otherwise. */
function choice<K extends string>(items: readonly MenuButtonItem<K>[]) {
  if (items.some((i) => i.checked !== undefined)) return { selectionMode: 'single' as const, selectedKeys: items.filter((i) => i.checked).map((i) => i.id), onSelectionChange: () => {} };
  if (items.some((i) => i.marked !== undefined)) return { selectionMode: 'multiple' as const, selectedKeys: items.filter((i) => i.marked).map((i) => i.id), onSelectionChange: () => {} };
  return { selectionMode: 'none' as const };
}

function Item<K extends string>({ item, platform }: { item: MenuButtonItem<K>; platform: string }) {
  return (
    <MenuItem
      id={item.id}
      textValue={item.label}
      className={cx('mi', item.description !== undefined && 'two', item.info && 'info')}
      isDisabled={item.isDisabled || item.info}
      data-testid={item.testId}
      data-force={item.force?.join(' ')}
      data-indent={item.indent}
      style={item.indent ? ({ '--indent': item.indent } as CSSProperties) : undefined}
    >
      <span className="check" aria-hidden="true">
        {(item.checked || item.marked) && <Icon icon={Check} size="sm" />}
      </span>
      {item.description === undefined ? (
        <span className="mi-label">{item.label}</span>
      ) : (
        // The label names the row and the line under it describes it (aria-labelledby and aria-describedby).
        <span className="mi-text">
          <Text slot="label" className="mi-label">
            {item.label}
          </Text>
          <Text slot="description" className="mi-desc">
            {item.description}
          </Text>
        </span>
      )}
      {item.accelerator && <span className="shortcut">{acceleratorLabel(item.accelerator, platform)}</span>}
    </MenuItem>
  );
}

function SubmenuRow<K extends string>({ entry, onAction, platform }: { entry: MenuSubmenu<K>; onAction(id: K): void; platform: string }) {
  return (
    <SubmenuTrigger>
      <MenuItem id={entry.id} textValue={entry.label} className="mi mi-sub" isDisabled={entry.isDisabled} data-testid={entry.testId}>
        <span className="check" aria-hidden="true" />
        <span className="mi-label">{entry.label}</span>
        <span className="sub-chevron" aria-hidden="true">
          <Icon icon={ChevronRight} size="sm" />
        </span>
      </MenuItem>
      {/* offset 4 puts the fly-out about 2 over the parent's edge (the row ends 5 inside it, the popover rounds to a whole pixel); crossOffset -5 is the menu's own padding, so the first item stands level with the row. Both mirror when it flips left. */}
      <Popover className="menu-popover" offset={4} crossOffset={-5}>
        <Menu className="menu" aria-label={entry.label} shouldCloseOnSelect onAction={(key) => onAction(String(key) as K)} {...choice(entry.items)}>
          {entry.items.map((item) => (
            <Item key={item.id} item={item} platform={platform} />
          ))}
        </Menu>
      </Popover>
    </SubmenuTrigger>
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
  const topItems = props.entries.filter((e): e is MenuButtonItem<K> => !isSeparator(e) && !isSection(e) && !isSubmenu(e));
  return (
    <Menu
      className="menu"
      aria-label={props['aria-label']}
      style={props.style}
      data-testid={props.testId}
      shouldCloseOnSelect
      onAction={(key) => props.onAction(String(key) as K)}
      {...choice(topItems)}
    >
      {props.entries.map((entry, i) => {
        if (isSeparator(entry)) return <Separator key={`sep-${i}`} className="msep" />;
        if (isSubmenu(entry)) return <SubmenuRow key={entry.id} entry={entry} onAction={props.onAction} platform={platform} />;
        if (isSection(entry)) {
          return (
            <MenuSection key={`sec-${i}`} id={`sec-${i}`} shouldCloseOnSelect {...choice(entry.items)}>
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
  /** How the button is drawn, as Button's: the bordered secondary one (default) or the plain one inside a toolbar. */
  variant?: 'secondary' | 'plain';
  size?: 'regular' | 'small';
  /** Extra class on the popover, for a menu that needs its own width. */
  popoverClassName?: string;
  testId?: string;
}) {
  const reason = useDisabledReason(props.isDisabled, props.disabledReason);
  // Controlled, so a soft-disabled trigger (focusable, aria-disabled) can never open the menu.
  const [isOpen, setOpen] = useState(false);
  const trigger = (
    <AriaButton className={cx('btn', `btn-${props.variant ?? 'secondary'}`, props.size === 'small' && 'btn-small', props.icon && 'has-icon', 'has-menu')} {...reason.controlProps} data-testid={props.testId}>
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
        <Popover className={cx('menu-popover', props.popoverClassName)} placement={props.placement ?? 'bottom start'} offset={4}>
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
  /** Extra class on the popover, for a menu that needs its own width. */
  popoverClassName?: string;
  /** The box the menu lines up with in place of the button (a field and its chevron are one group). */
  anchorRef?: RefObject<Element | null>;
  isDisabled?: boolean;
  /** Why it is disabled (see MenuButton): the button stays focusable and never opens. */
  disabledReason?: string;
  testId?: string;
}) {
  // Controlled, so a disabled trigger can never open the menu.
  const [isOpen, setOpen] = useState(false);
  return (
    <MenuTrigger isOpen={isOpen && !props.isDisabled} onOpenChange={(open) => setOpen(open && !props.isDisabled)}>
      <IconButton icon={props.icon} label={props.label} size={props.size ?? 'small'} testId={props.testId} isDisabled={props.isDisabled} disabledReason={props.disabledReason} />
      <Popover className={cx('menu-popover', props.popoverClassName)} placement={props.placement ?? 'bottom end'} offset={4} triggerRef={props.anchorRef}>
        <MenuList entries={props.items} onAction={props.onAction} aria-label={props.label} />
      </Popover>
    </MenuTrigger>
  );
}
