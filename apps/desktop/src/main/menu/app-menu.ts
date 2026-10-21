import type { MenuItemConstructorOptions } from 'electron';
import { COMMANDS, MAIN_OWNED_COMMANDS, commandLabel, platformAccelerator, type CommandId, type CommandSpec, type MenuName } from '@learn/domain';

/** Pure template builder (type-only Electron import) so the menu tree is unit-tested. */
export interface AppMenuOptions {
  /** Shows "개발자 도구". Unpackaged runs only, and never under E2E (`LEARN_E2E=1`). */
  isDev: boolean;
  platform: NodeJS.Platform;
  commands: readonly CommandSpec[];
  /** availableMenuCommands(context at build time): the only registry items that start enabled (applyMenuEnabled flips them later). */
  enabled: ReadonlySet<CommandId>;
  /** Registry item clicked (mouse or accelerator). */
  onCommand(id: CommandId): void;
}

type Item = MenuItemConstructorOptions;
const SEP: Item = { type: 'separator' };

/** ⌘+ is typed as ⌘= on US keyboards: a hidden item with the same command answers it. */
const TWINS: Readonly<Record<string, readonly string[]>> = { 'CmdOrCtrl+Plus': ['CmdOrCtrl+='] };
const twinAccelerators = (c: CommandSpec): readonly string[] => (c.accelerator ? TWINS[c.accelerator] : undefined) ?? [];

/** Menu item ids a command produces: its own id, then `${id}#n` for each hidden accelerator twin. Build and toggle share it. */
export function menuItemIds(c: CommandSpec): string[] {
  return [c.id, ...twinAccelerators(c).map((_, i) => `${c.id}#${i + 1}`)];
}

const isEnabled = (id: CommandId, enabled: ReadonlySet<CommandId>): boolean => enabled.has(id) || MAIN_OWNED_COMMANDS.has(id);

/** Where a command lands on this platform: "app" items move to the end of 파일 off macOS. */
function placement(c: CommandSpec, platform: NodeJS.Platform): { menu: MenuName; group: number; order: number } | null {
  if (!c.menu) return null;
  if (c.menu.menu === 'app' && platform !== 'darwin') return { menu: 'file', group: 90 + c.menu.group, order: c.menu.order };
  return c.menu;
}

function commandItems(c: CommandSpec, opts: AppMenuOptions): Item[] {
  const enabled = isEnabled(c.id, opts.enabled);
  const click = () => opts.onCommand(c.id);
  const label = commandLabel(c, opts.platform);
  const [id, ...twinIds] = menuItemIds(c);
  const item: Item = { id, label, enabled, click };
  if (c.accelerator) item.accelerator = platformAccelerator(c.accelerator, opts.platform);
  return [item, ...twinAccelerators(c).map((acc, i): Item => ({ id: twinIds[i], label, enabled, visible: false, accelerator: platformAccelerator(acc, opts.platform), click }))];
}

/** Registry commands for one menu, grouped (separator between groups) and ordered. */
function registryItems(name: MenuName, opts: AppMenuOptions): Item[] {
  const placed = opts.commands
    .flatMap((c) => {
      const at = placement(c, opts.platform);
      return at?.menu === name ? [{ c, at }] : [];
    })
    .sort((a, b) => a.at.group - b.at.group || a.at.order - b.at.order);
  const out: Item[] = [];
  let group: number | null = null;
  for (const { c, at } of placed) {
    if (group !== null && at.group !== group) out.push(SEP);
    group = at.group;
    out.push(...commandItems(c, opts));
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
    label: 'Learn',
    submenu: join(
      [{ role: 'about', label: 'Learn 정보' }],
      reg('app'),
      [{ role: 'services', label: '서비스' }],
      [{ role: 'hide', label: 'Learn 가리기' }, { role: 'hideOthers', label: '기타 가리기' }, { role: 'unhide', label: '모두 보기' }],
      [{ role: 'quit', label: 'Learn 종료' }],
    ),
  };
  const file: Item = { id: 'menu.file', label: '파일', submenu: join(reg('file'), [{ role: 'close', label: '창 닫기', accelerator: 'CmdOrCtrl+W' }]) };
  const edit: Item = {
    id: 'menu.edit',
    label: '편집',
    submenu: join(
      [{ role: 'undo', label: '실행 취소' }, { role: 'redo', label: '실행 복귀' }],
      [{ role: 'cut', label: '오려두기' }, { role: 'copy', label: '복사하기' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '모두 선택' }],
      reg('edit'),
    ),
  };
  const view: Item = {
    id: 'menu.view',
    label: '보기',
    submenu: join(reg('view'), [{ role: 'togglefullscreen', label: '전체 화면' }], opts.isDev ? [{ role: 'toggleDevTools', label: '개발자 도구' }] : []),
  };
  const go: Item = { id: 'menu.go', label: '이동', submenu: reg('go') };
  const windowMenu: Item = {
    id: 'menu.window',
    label: '윈도우',
    role: 'windowMenu',
    submenu: join(
      // Not 'close' off macOS: the file menu already has "창 닫기" with the same accelerator.
      [{ role: 'minimize', label: '최소화' }, ...(mac ? [{ role: 'zoom', label: '확대/축소' } satisfies Item] : [])],
      mac ? [{ role: 'front', label: '모두 앞으로 가져오기' }] : [],
      reg('window'),
    ),
  };
  const help: Item = { id: 'menu.help', label: '도움말', role: 'help', submenu: reg('help') };
  return [...(mac ? [appMenu] : []), file, edit, view, go, windowMenu, help].filter((m) => Array.isArray(m.submenu) && m.submenu.length > 0);
}

/** What applyMenuEnabled needs from Electron's Menu (a plain lookup in unit tests). */
export interface MenuItemLookup {
  getMenuItemById(id: string): { enabled?: boolean } | null;
}

/**
 * Applies a reported context to an already-built menu by flipping `enabled` in place on every registry item and its
 * hidden twins. No rebuild: an open dropdown stays open, no window gets setMenu again, and it stays cheap when reports
 * come quickly. Commands without a menu-bar placement are not looked up; ids the menu lacks are skipped.
 */
export function applyMenuEnabled(menu: MenuItemLookup, enabled: ReadonlySet<CommandId>, commands: readonly CommandSpec[] = COMMANDS): void {
  for (const c of commands) {
    if (!c.menu) continue;
    const on = isEnabled(c.id, enabled);
    for (const id of menuItemIds(c)) {
      const item = menu.getMenuItemById(id);
      if (item) item.enabled = on;
    }
  }
}
