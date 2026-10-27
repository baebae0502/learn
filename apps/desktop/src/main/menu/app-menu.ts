import type { MenuItemConstructorOptions } from 'electron';
import {
  COMMANDS, MAIN_OWNED_COMMANDS, NO_LIBRARY_VIEW, SUBMENUS, commandLabel, platformAccelerator,
  type CommandArgs, type CommandContextState, type CommandId, type CommandSpec, type MenuName, type OrganizeSnapshot, type PickedCommand, type SubmenuSpec,
} from '@learn/domain';
import { mainStrings } from '../strings';
import { dotIcon } from './dot-icon';
import { entriesToTemplate, type TemplateOptions } from './entries';
import { colorTagGroup, valueRows, type SubmenuInput } from './submenus';

/** Pure template builder (type-only Electron import) so the menu tree is unit-tested. */
export interface AppMenuOptions {
  /** Shows "개발자 도구". Unpackaged runs only, and never under E2E (`LEARN_E2E=1`). */
  isDev: boolean;
  platform: NodeJS.Platform;
  commands: readonly CommandSpec[];
  /** availableMenuCommands(context at build time): the only registry items that start enabled (applyMenuEnabled flips them later). */
  enabled: ReadonlySet<CommandId>;
  /** Registry item clicked (mouse or accelerator); `args` is the value of a submenu row. */
  onCommand(id: CommandId, args?: CommandArgs): void;
  /** The reported UI state that state labels follow (design-spec 7.4); absent before the first report. */
  labels?: MenuLabelState;
  /** Whether the main window is in full screen now (the macOS item says what it will do: 시작 / 종료). */
  fullScreenState?: boolean;
  /** Whether the macOS 전체 화면 item can run: a main window exists and none of our sheets is attached. Default true. */
  fullScreenAvailable?: boolean;
  /** macOS: the 전체 화면 item's click and ⌃⌘F toggle the main window's full screen. */
  onToggleFullScreen?(): void;
  /** The reported context the value submenus are drawn from (the sort in force, the columns drawn); the empty library view before the first report. */
  context?: CommandContextState;
  /** Collections and tags as the menu bar's submenus list them; absent or null when no item uses them or the library is not open. */
  organize?: OrganizeSnapshot | null;
  /** The grouped submenus; the registry's by default. */
  submenus?: readonly SubmenuSpec[];
}

const copy = mainStrings.menu;

/** The macOS 전체 화면 item: Apple Korean names it by what it will do; the neutral name is spec 7.4's. */
export const FULL_SCREEN = {
  id: 'menu.view.fullScreen',
  label: copy.fullScreen.label,
  stateLabels: { windowed: copy.fullScreen.windowed, fullscreen: copy.fullScreen.fullscreen },
} as const;
const fullScreenLabel = (fullscreen: boolean) => FULL_SCREEN.stateLabels[fullscreen ? 'fullscreen' : 'windowed'];

/**
 * macOS: our own item, no role. Electron's togglefullscreen role uses the toggleFullScreenMode: selector, and AppKit
 * on macOS 15 shows a second, visible copy of such an item with the system's fn F (runs 39618864364 – 39640208719); a
 * plain item on ⌃⌘F is the one row (R2-1 spike, run 39640208719). Linux/Windows keep the role (F11).
 */
function fullScreenItems(opts: AppMenuOptions): Item[] {
  if (opts.platform !== 'darwin') return [{ role: 'togglefullscreen', label: FULL_SCREEN.label }];
  return [
    {
      id: FULL_SCREEN.id,
      label: fullScreenLabel(opts.fullScreenState ?? false),
      accelerator: 'Ctrl+Cmd+F',
      enabled: opts.fullScreenAvailable ?? true,
      click: () => opts.onToggleFullScreen?.(),
    },
  ];
}

type Item = MenuItemConstructorOptions;
const SEP: Item = { type: 'separator' };

/** The reported pane states that state labels follow (design-spec 7.4). */
export type MenuLabelState = Pick<CommandContextState, 'sidebar' | 'inspector'>;

/** The pane states of a reported context, without the absent ones (the fatal screen reports neither). */
export function menuLabelState(ctx: MenuLabelState): MenuLabelState {
  return { ...(ctx.sidebar ? { sidebar: ctx.sidebar } : {}), ...(ctx.inspector ? { inspector: ctx.inspector } : {}) };
}

/** Whether a new report renames a menu item: a pane state that a state label follows has changed. */
export function menuLabelsChanged(before: MenuLabelState, after: MenuLabelState): boolean {
  return before.sidebar !== after.sidebar || before.inspector !== after.inspector;
}

/** ⌘+ is typed as ⌘= on US keyboards: a hidden item with the same command answers it. */
const TWINS: Readonly<Record<string, readonly string[]>> = { 'CmdOrCtrl+Plus': ['CmdOrCtrl+='] };
const twinAccelerators = (c: CommandSpec): readonly string[] => (c.accelerator ? TWINS[c.accelerator] : undefined) ?? [];

/** Menu item ids a command produces: its own id, then `${id}#n` for each hidden accelerator twin. Build and toggle share it. */
export function menuItemIds(c: CommandSpec): string[] {
  return [c.id, ...twinAccelerators(c).map((_, i) => `${c.id}#${i + 1}`)];
}

const isEnabled = (id: CommandId, enabled: ReadonlySet<CommandId>): boolean => enabled.has(id) || MAIN_OWNED_COMMANDS.has(id);

/** Where a command or a group lands on this platform: "app" items move to the end of 파일 off macOS. */
function placement(at: CommandSpec['menu'], platform: NodeJS.Platform): { menu: MenuName; group: number; order: number } | null {
  if (!at) return null;
  if (at.menu === 'app' && platform !== 'darwin') return { menu: 'file', group: 90 + at.group, order: at.order };
  return at;
}

const DEFAULT_CONTEXT: CommandContextState = Object.freeze({
  view: 'library', blocked: false, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW,
});

/** A pick from a row of a submenu is a command with the row's value. */
const picker = (opts: AppMenuOptions) => (picked: PickedCommand | null): void => {
  if (picked) opts.onCommand(picked.commandId, picked.args);
};

/** The menu bar's rows: key equivalents are live there (see entriesToTemplate), and a row with a colour draws its dot (M-2), as the popups do. */
const barOptions = (opts: AppMenuOptions): TemplateOptions => ({ surface: 'menubar', platform: opts.platform, dotIcon });

/** What the submenus are built from: the reported context and the library read for the menu bar (no selection, so no marks). */
function submenuInput(opts: AppMenuOptions): SubmenuInput {
  return { organize: opts.organize ?? null, itemIds: [], context: opts.context ?? DEFAULT_CONTEXT, enabledOf: (c) => isEnabled(c.id, opts.enabled) };
}

function commandItems(c: CommandSpec, opts: AppMenuOptions): Item[] {
  const enabled = isEnabled(c.id, opts.enabled);
  const label = commandLabel(c, opts.platform, opts.labels);
  if (c.submenu !== undefined) {
    // The head is the command and is switched in place; its rows are always on (they are reachable only through it).
    // A submenu with nothing to list is left out rather than drawn empty.
    const rows = valueRows(c, submenuInput(opts), true);
    return rows.length === 0 ? [] : [{ id: c.id, label, enabled, submenu: entriesToTemplate(rows, picker(opts), barOptions(opts)) }];
  }
  const click = () => opts.onCommand(c.id);
  const [id, ...twinIds] = menuItemIds(c);
  const item: Item = { id, label, enabled, click };
  if (c.accelerator) item.accelerator = platformAccelerator(c.accelerator, opts.platform);
  return [item, ...twinAccelerators(c).map((acc, i): Item => ({ id: twinIds[i], label, enabled, visible: false, accelerator: platformAccelerator(acc, opts.platform), click }))];
}

/** A group's head with its members, as one item; nothing when it has no member to show. */
function groupItems(s: SubmenuSpec, opts: AppMenuOptions): Item[] {
  const entry = colorTagGroup(s, opts.commands, submenuInput(opts));
  return entry ? entriesToTemplate([entry], picker(opts), barOptions(opts)) : [];
}

/** Registry commands and groups for one menu, merged by group then order (separator between groups) and built. */
function registryItems(name: MenuName, opts: AppMenuOptions): Item[] {
  interface Placed {
    at: { group: number; order: number };
    build(): Item[];
  }
  const commands = opts.commands.flatMap((c): Placed[] => {
    const at = placement(c.menu, opts.platform);
    return at?.menu === name ? [{ at, build: () => commandItems(c, opts) }] : [];
  });
  const groups = (opts.submenus ?? SUBMENUS).flatMap((s): Placed[] => {
    const at = placement(s.menu, opts.platform);
    return at?.menu === name ? [{ at, build: () => groupItems(s, opts) }] : [];
  });
  const built = [...commands, ...groups]
    .sort((a, b) => a.at.group - b.at.group || a.at.order - b.at.order)
    .map((p) => ({ at: p.at, items: p.build() }))
    .filter((p) => p.items.length > 0);
  const out: Item[] = [];
  let group: number | null = null;
  for (const { at, items } of built) {
    if (group !== null && at.group !== group) out.push(SEP);
    group = at.group;
    out.push(...items);
  }
  return out;
}

/** Non-empty groups joined by separators. */
const join = (...groups: Item[][]): Item[] => groups.filter((g) => g.length > 0).flatMap((g, i) => (i === 0 ? g : [SEP, ...g]));

/**
 * Korean application menu built from the command registry (ADR-0005). No Reload / Force Reload anywhere;
 * "개발자 도구" only when `isDev`. Menus with no items are left out.
 */
export function buildAppMenu(opts: AppMenuOptions): Item[] {
  const mac = opts.platform === 'darwin';
  const reg = (name: MenuName) => registryItems(name, opts);
  const appMenu: Item = {
    id: 'menu.app',
    label: copy.top.app,
    submenu: join(
      [{ role: 'about', label: copy.app.about }],
      reg('app'),
      [{ role: 'services', label: copy.app.services }],
      [{ role: 'hide', label: copy.app.hide }, { role: 'hideOthers', label: copy.app.hideOthers }, { role: 'unhide', label: copy.app.unhide }],
      [{ role: 'quit', label: copy.app.quit }],
    ),
  };
  const close: Item = { role: 'close', label: mac ? copy.close.mac : copy.close.other, accelerator: 'CmdOrCtrl+W' };
  const file: Item = { id: 'menu.file', label: copy.top.file, submenu: join(reg('file'), [close]) };
  const edit: Item = {
    id: 'menu.edit',
    label: copy.top.edit,
    submenu: join(
      [{ role: 'undo', label: copy.edit.undo }, { role: 'redo', label: copy.edit.redo }],
      [{ role: 'cut', label: copy.edit.cut }, { role: 'copy', label: copy.edit.copy }, { role: 'paste', label: copy.edit.paste }, { role: 'selectAll', label: copy.edit.selectAll }],
      reg('edit'),
    ),
  };
  const view: Item = {
    id: 'menu.view',
    label: copy.top.view,
    // The item panel owns the role's default key on macOS, so a dev build moves the developer tools.
    submenu: join(reg('view'), fullScreenItems(opts), opts.isDev ? [{ role: 'toggleDevTools', label: copy.devTools, accelerator: 'Alt+CmdOrCtrl+J' }] : []),
  };
  const go: Item = { id: 'menu.go', label: copy.top.go, submenu: reg('go') };
  const windowMenu: Item = {
    id: 'menu.window',
    label: copy.top.window,
    role: 'windowMenu',
    submenu: join(
      // Not 'close' off macOS: the file menu already has "창 닫기" with the same accelerator.
      [{ role: 'minimize', label: copy.window.minimize }, ...(mac ? [{ role: 'zoom', label: copy.window.zoom } satisfies Item] : [])],
      mac ? [{ role: 'front', label: copy.window.front }] : [],
      reg('window'),
    ),
  };
  const help: Item = { id: 'menu.help', label: copy.top.help, role: 'help', submenu: join(reg('help'), mac ? [] : [{ role: 'about', label: copy.aboutOther }]) };
  return [...(mac ? [appMenu] : []), file, edit, view, go, windowMenu, help].filter((m) => Array.isArray(m.submenu) && m.submenu.length > 0);
}

/** What applyMenuEnabled / applyMenuLabels need from Electron's Menu (a plain lookup in unit tests). */
export interface MenuItemLookup {
  getMenuItemById(id: string): { enabled?: boolean; label?: string } | null;
}

/**
 * Applies a reported context to an already-built menu by flipping `enabled` in place on every registry item and its
 * hidden twins, on the members of a placed group and on the group's head. No rebuild: an open dropdown stays open, no
 * window gets setMenu again, and it stays cheap when reports come quickly. Commands without a menu-bar placement are not
 * looked up; ids the menu lacks are skipped.
 */
export function applyMenuEnabled(
  menu: MenuItemLookup,
  enabled: ReadonlySet<CommandId>,
  commands: readonly CommandSpec[] = COMMANDS,
  submenus: readonly SubmenuSpec[] = SUBMENUS,
): void {
  const grouped = new Set<CommandId>(submenus.flatMap((s) => (s.menu ? s.commands : [])));
  for (const c of commands) {
    if (!c.menu && !grouped.has(c.id)) continue;
    const on = isEnabled(c.id, enabled);
    for (const id of menuItemIds(c)) {
      const item = menu.getMenuItemById(id);
      if (item) item.enabled = on;
    }
  }
  for (const s of submenus) {
    if (!s.menu) continue;
    const head = menu.getMenuItemById(`submenu.${s.id}`);
    if (head) head.enabled = s.commands.some((id) => isEnabled(id, enabled));
  }
}

/**
 * What the menu bar's value submenus are drawn from in a reported context. A change is a different menu (the rows are
 * the columns drawn, the radios the sort in force), so main rebuilds it; every other part of a report flips `enabled`.
 */
export const submenuShapeKey = (ctx: Pick<CommandContextState, 'sortColumn' | 'sortDirection' | 'columnsShown'>): string =>
  `${ctx.sortColumn}|${ctx.sortDirection}|${ctx.columnsShown}`;

/**
 * Relabels the items of commands with state labels in place (MenuItem.label is dynamic in Electron 44; macOS picks it
 * up when the menu opens). Same ids, accelerators and enabled state: nothing is rebuilt.
 */
export function applyMenuLabels(
  menu: MenuItemLookup,
  platform: NodeJS.Platform,
  state: MenuLabelState,
  commands: readonly CommandSpec[] = COMMANDS,
): void {
  for (const c of commands) {
    if (!c.menu || !c.stateLabels) continue;
    const label = commandLabel(c, platform, state);
    for (const id of menuItemIds(c)) {
      const item = menu.getMenuItemById(id);
      if (item) item.label = label;
    }
  }
}

/** The main window's state as the macOS 전체 화면 item needs it. */
export interface FullScreenItemState {
  /** A main window exists and none of our sheets is attached to it (the registry's `blocked`). */
  available: boolean;
  fullscreen: boolean;
}

/**
 * macOS: the 전체 화면 item, updated in place from the main window's state — named by what it will do (전체 화면 시작 /
 * 종료) and disabled without a main window or while one of our sheets is attached. Main calls it whenever a main
 * window opens or closes, enters or leaves full screen, or a sheet comes or goes, so the label is never stale.
 */
export function applyFullScreenItem(menu: MenuItemLookup, platform: NodeJS.Platform, state: FullScreenItemState): void {
  if (platform !== 'darwin') return;
  const item = menu.getMenuItemById(FULL_SCREEN.id);
  if (!item) return;
  item.label = fullScreenLabel(state.fullscreen);
  item.enabled = state.available;
}
