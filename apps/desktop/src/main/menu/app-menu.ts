import type { MenuItemConstructorOptions } from 'electron';
import type { CommandId, CommandSpec, MenuName } from '@learn/domain';

/** Pure template builder (type-only Electron import) so the menu tree is unit-tested. */
export interface AppMenuOptions {
  /** Shows "개발자 도구". Unpackaged runs only, and never under E2E (`LEARN_E2E`). */
  isDev: boolean;
  platform: NodeJS.Platform;
  commands: readonly CommandSpec[];
  /** Registry item clicked (mouse or accelerator). Availability is decided by the renderer's handler. */
  onCommand(id: CommandId): void;
}

type Item = MenuItemConstructorOptions;
const SEP: Item = { type: 'separator' };

/** Registry commands for one menu, grouped (separator between groups) and ordered. */
function registryItems(name: MenuName, opts: AppMenuOptions): Item[] {
  const placed = opts.commands
    .flatMap((c) => (c.menu?.menu === name ? [{ c, at: c.menu }] : []))
    .sort((a, b) => a.at.group - b.at.group || a.at.order - b.at.order);
  const out: Item[] = [];
  let group: number | null = null;
  for (const { c, at } of placed) {
    if (group !== null && at.group !== group) out.push(SEP);
    group = at.group;
    const item: Item = { id: c.id, label: c.label, click: () => opts.onCommand(c.id) };
    if (c.accelerator) item.accelerator = c.accelerator;
    out.push(item);
  }
  return out;
}

/** Built-ins first, then registry items for the same menu after a separator. */
const withRegistry = (name: MenuName, builtins: Item[], opts: AppMenuOptions): Item[] => {
  const extra = registryItems(name, opts);
  return builtins.length > 0 && extra.length > 0 ? [...builtins, SEP, ...extra] : [...builtins, ...extra];
};

/**
 * Korean application menu built from the command registry. No Reload / Force Reload anywhere;
 * "개발자 도구" only when `isDev`. Linux/Windows get the same menus minus the macOS app menu.
 */
export function buildAppMenu(opts: AppMenuOptions): Item[] {
  const mac = opts.platform === 'darwin';
  const appMenu: Item = {
    id: 'menu.app',
    label: 'Learn',
    submenu: [
      { role: 'about', label: 'Learn 정보' },
      SEP,
      { role: 'services', label: '서비스' },
      SEP,
      { role: 'hide', label: 'Learn 가리기' },
      { role: 'hideOthers', label: '기타 가리기' },
      { role: 'unhide', label: '모두 보기' },
      SEP,
      { role: 'quit', label: 'Learn 종료' },
    ],
  };
  // File: registry commands first, then "창 닫기".
  const fileCommands = registryItems('file', opts);
  const file: Item = {
    id: 'menu.file',
    label: '파일',
    submenu: [...fileCommands, ...(fileCommands.length > 0 ? [SEP] : []), { role: 'close', label: '창 닫기', accelerator: 'CmdOrCtrl+W' }],
  };
  const edit: Item = {
    id: 'menu.edit',
    label: '편집',
    submenu: withRegistry('edit', [
      { role: 'undo', label: '실행 취소' },
      { role: 'redo', label: '실행 복귀' },
      SEP,
      { role: 'cut', label: '오려두기' },
      { role: 'copy', label: '복사하기' },
      { role: 'paste', label: '붙여넣기' },
      { role: 'selectAll', label: '모두 선택' },
    ], opts),
  };
  const view: Item = {
    id: 'menu.view',
    label: '보기',
    submenu: withRegistry('view', [
      { role: 'togglefullscreen', label: '전체 화면' },
      ...(opts.isDev ? [SEP, { role: 'toggleDevTools', label: '개발자 도구' } satisfies Item] : []),
    ], opts),
  };
  const go: Item = { id: 'menu.go', label: '이동', submenu: withRegistry('go', [], opts) };
  const windowMenu: Item = {
    id: 'menu.window',
    label: '윈도우',
    role: 'windowMenu',
    submenu: withRegistry('window', mac
      ? [{ role: 'minimize', label: '최소화' }, { role: 'zoom', label: '확대/축소' }, SEP, { role: 'front', label: '모두 앞으로 가져오기' }]
      // Not 'close': the file menu already has "창 닫기" with the same accelerator.
      : [{ role: 'minimize', label: '최소화' }], opts),
  };
  return [...(mac ? [appMenu] : []), file, edit, view, go, windowMenu];
}
