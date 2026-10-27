import type { KeySpec } from './accelerator';
import type { Availability, StorageMode } from './library';
import { DEFAULT_COLUMN_CONFIG, columnsMask, type LibrarySortColumn } from './library-columns';
import type { LibraryScope } from './organize';

/**
 * Single command registry (ADR-0005): the menu bar, ⌘K palette, native context menus, toolbar tooltips and the
 * shortcut sheet all render from it, and one predicate (isCommandAvailable) decides what can run.
 * No zod: the sandboxed preload imports this file (type imports only).
 */
export type CommandId =
  | 'file.importManaged'
  | 'file.importLinked'
  | 'library.find'
  | 'library.findEverywhere'
  | 'nav.back'
  | 'item.open'
  | 'item.showInFolder'
  | 'item.openExternally'
  | 'item.editInfo'
  | 'item.exportCopy'
  | 'collection.addItems'
  | 'collection.removeItems'
  | 'item.relink'
  | 'collection.new'
  | 'collection.newChild'
  | 'collection.rename'
  | 'collection.importInto'
  | 'collection.delete'
  | 'tag.color1'
  | 'tag.color2'
  | 'tag.color3'
  | 'tag.color4'
  | 'tag.color5'
  | 'tag.color6'
  | 'tag.color7'
  | 'tag.color8'
  | 'tag.rename'
  | 'tag.setColor'
  | 'tag.clearColor'
  | 'tag.delete'
  | 'tags.clearFilter'
  | 'view.toggleSidebar'
  | 'view.toggleInspector'
  | 'app.shortcuts'
  | 'app.palette'
  | 'app.settings'
  | 'view.textBigger'
  | 'view.textSmaller'
  | 'view.textReset'
  | 'view.nextPane'
  | 'view.previousPane'
  | 'library.sortBy';
/**
 * `app`: anywhere in the main window; `library` / `viewer`: the current view; `item` / `collection` / `tag`: needs a
 * target of that kind (judged on the targets handed in; the first of these a command lists decides).
 */
export type CommandContext = 'app' | 'library' | 'viewer' | 'item' | 'collection' | 'tag';
/** `app` is the macOS application menu (Linux/Windows put those items at the end of 파일); `help` is 도움말. */
export type MenuName = 'app' | 'file' | 'edit' | 'view' | 'go' | 'window' | 'help';
export const CONTEXT_MENU_KINDS = ['item', 'collection', 'tag', 'column'] as const;
/** Native context menus (ADR-0005 §4): items now; collections, tags and table column headers from M4–M5. */
export type ContextMenuKind = (typeof CONTEXT_MENU_KINDS)[number];

/**
 * The value a menu row gives a command beyond its target (spec 9.1): a value submenu is one command with a row per
 * value, and the row's value travels with the pick to the handler as `target.args`.
 */
export interface CommandArgs {
  /** collection.addItems: the collection to file the selection into. */
  collectionId?: string;
  /** tag.setColor: the colour slot 1–8 (colour N = slot N = key N). */
  position?: number;
  /** library.sortBy: the column and/or the direction. */
  column?: LibrarySortColumn;
  direction?: 'asc' | 'desc';
  /** collection.addItems without a collectionId: a new collection that takes the selection. */
  addSelection?: true;
}
/** What a native menu answers, and what a menu-bar click sends the renderer. */
export interface PickedCommand {
  commandId: CommandId;
  args?: CommandArgs;
}

/** `k=v` pairs, keys sorted: one name for a value, so a menu item's id and a test name a row the same way. */
export const argsKey = (args: CommandArgs): string =>
  Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
/** The id of a menu item: the command's, with its value when the row carries one (`library.sortBy?column=year`). */
export const menuItemId = (id: CommandId, args?: CommandArgs): string => {
  const key = args ? argsKey(args) : '';
  return key === '' ? id : `${id}?${key}`;
};

/** Where a value submenu's rows come from: main builds them from the library (collections, colours) or the reported context (columns). */
export type SubmenuSource = 'collections' | 'tagColors' | 'sortColumns';
/** Which menus each source can fill: `submenuProblems` checks a command's placement against it. */
export const SUBMENU_SOURCES: Readonly<Record<SubmenuSource, { menuBar: boolean; contextKinds: readonly ContextMenuKind[] }>> = {
  collections: { menuBar: true, contextKinds: ['item', 'collection'] },
  tagColors: { menuBar: false, contextKinds: ['tag'] },
  sortColumns: { menuBar: true, contextKinds: [] },
};

/** Whether a pane is shown — what a pane toggle's state label depends on. */
export type PaneShown = 'shown' | 'hidden';
/** Whether the sidebar is shown (layout B) — what the sidebar command's label depends on. */
export type SidebarState = PaneShown;

export interface CommandSpec {
  id: CommandId;
  /**
   * Korean label exactly as menus show it ("…" when more input follows). For a command with `stateLabels` this is the
   * neutral name, used where no state applies (the ⌘/ shortcut sheet, the key map).
   */
  label: string;
  /**
   * Mac pattern for a toggle (design-spec 7.4): the menu, the tooltip and the palette name what the command does now —
   * "사이드바 가리기" while the sidebar is shown, "사이드바 보기" while it is hidden. One command, one id, one shortcut.
   * Exactly one key: the reported pane state the label follows.
   */
  stateLabels?: { sidebar?: Readonly<Record<PaneShown, string>>; inspector?: Readonly<Record<PaneShown, string>> };
  /** Label off macOS when the macOS one names a macOS app (Finder). */
  labelOff?: string;
  /**
   * The name the ⌘K palette shows when the menu around the command gives it a noun the palette lacks (spec 9.3): the
   * collection menu says 이름 바꾸기, the palette 컬렉션 이름 바꾸기, so it is not taken for a tag's.
   */
  paletteLabel?: string;
  /** Electron accelerator, owned by the native menu. */
  accelerator?: string;
  /** Single-key shortcut, matched by physical key in the renderer keymap. */
  key?: KeySpec;
  menu?: { menu: MenuName; group: number; order: number };
  /** Native context menus listing this command; separators between groups. */
  contextMenu?: { kinds: readonly ContextMenuKind[]; group: number; order: number; onlyWhenAvailable?: boolean };
  /**
   * Shown as a submenu (spec 9.1): one row per value, built by main from this source; a row runs this command with its
   * value as `args`. The command owns the whole submenu and is kept out of the palette (a palette run carries no value).
   */
  submenu?: SubmenuSource;
  contexts: CommandContext[];
  /** In the ⌘K palette while available. Default: yes, unless the command needs item targets. */
  palette?: boolean;
  /** Extra palette search words: Korean first (초성 search applies), English for habit. */
  keywords?: readonly string[];
  /**
   * Moves the focus and changes no data (F6): it still runs while work in progress holds the window (an import), and
   * only a modal surface stops it (isCommandAvailable's `surface`). Finder and VS Code never take focus movement away
   * while a copy or a task runs.
   */
  duringWork?: true;
}

/** Electron accelerator grammar used by the registry (design-spec 7.4 keys included). */
export const ACCELERATOR_SYNTAX = /^((CmdOrCtrl|Cmd|Ctrl|Alt|Shift)\+)*([A-Za-z0-9]|\[|\]|,|\/|-|Plus|F\d{1,2}|Enter|Delete|Backspace|Tab|Space|Escape)$/;

/** The eight colour slots (design-spec 4): colour N is slot N is key N. */
export const COLOR_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const colorId = (n: number) => `tag.color${n}` as CommandId;
const colorCommand = (n: (typeof COLOR_SLOTS)[number]): CommandSpec => ({
  id: colorId(n),
  label: `색 태그 ${n}`,
  key: { code: `Digit${n}` },
  contexts: ['item'],
  palette: true,
  keywords: ['색 태그', '태그', '색', '붙이기', '떼기', '라벨', 'tag', 'label'],
});

export const COMMANDS: readonly CommandSpec[] = [
  {
    id: 'file.importManaged', label: '파일 가져오기…', accelerator: 'CmdOrCtrl+O', menu: { menu: 'file', group: 1, order: 1 }, contexts: ['library'],
    keywords: ['가져오기', '추가', '사본', 'PDF', '동영상', 'import', 'add'],
  },
  {
    id: 'file.importLinked', label: '외부 파일 연결…', accelerator: 'Alt+CmdOrCtrl+O', menu: { menu: 'file', group: 1, order: 2 }, contexts: ['library'],
    keywords: ['연결', '외부', '링크', 'link'],
  },
  // 새 컬렉션 (spec 3.4): Finder's new folder — the sidebar makes the row and names it in place. 파일 group 1 after the
  // imports; the palette lists it too. Wherever the library shows, also while it is empty.
  {
    id: 'collection.new', label: '새\u00a0컬렉션', accelerator: 'Shift+CmdOrCtrl+N', menu: { menu: 'file', group: 1, order: 3 }, contexts: ['library'],
    keywords: ['컬렉션', '폴더', '만들기', '새로 만들기', 'collection', 'folder', 'new'],
  },
  // ⌘F (design-spec 7.4 라이브러리, 7.1: instead of type-ahead): the toolbar's quick search field takes the focus with
  // its text selected. 편집 › after the system's items; the empty library has no field, so nothing to find there.
  {
    id: 'library.find', label: '빠른 검색', accelerator: 'CmdOrCtrl+F', menu: { menu: 'edit', group: 1, order: 1 }, contexts: ['library'],
    keywords: ['검색', '찾기', 'search', 'find'],
  },
  // 내 라이브러리 전체에서 찾기 (spec 7.1): the no-results state's second button and a palette command — the view returns to
  // 내 라이브러리 and the query stays. No menu bar item, key or context menu: the design spec draws none for it.
  {
    id: 'library.findEverywhere', label: '내 라이브러리 전체에서 찾기', contexts: ['library'],
    keywords: ['전체', '검색', '찾기', '라이브러리', '범위', 'search', 'everywhere', 'all'],
  },
  {
    id: 'nav.back', label: '라이브러리로 돌아가기', accelerator: 'CmdOrCtrl+1', menu: { menu: 'go', group: 1, order: 1 }, contexts: ['viewer'],
    keywords: ['라이브러리', '뒤로', '목록', 'library', 'back'],
  },
  { id: 'item.relink', label: '다시 연결…', contexts: ['item'], contextMenu: { kinds: ['item'], group: 0, order: 1, onlyWhenAvailable: true } },
  { id: 'item.open', label: '열기', contexts: ['item'], contextMenu: { kinds: ['item'], group: 1, order: 1 } },
  // ⇧⌘R (design-spec 7.4 라이브러리): 파일 › and the item menu act on the one selected row; the menu bar judges the
  // reported selection counts, so it greys with no selection, several, or a missing file (and in the reader).
  {
    id: 'item.showInFolder', label: 'Finder에서 보기', labelOff: '폴더에서 보기', accelerator: 'Shift+CmdOrCtrl+R', menu: { menu: 'file', group: 2, order: 1 },
    contexts: ['item'], contextMenu: { kinds: ['item'], group: 2, order: 1 }, palette: true,
    keywords: ['폴더', '위치', '파인더', 'Finder', 'reveal'],
  },
  // 파일 › and the palette on the selected row, besides the notices' buttons. Still no item context-menu entry:
  // design-spec 7.3 lists none ("여기 없는 메뉴는 그리지 않는다").
  {
    id: 'item.openExternally', label: '기본 앱으로 열기', menu: { menu: 'file', group: 2, order: 3 }, contexts: ['item'], palette: true,
    keywords: ['기본 앱', '다른 앱', '외부 앱', 'open with', 'external'],
  },
  // 정보 편집 (spec §5.3): the palette and the 정보 section's pencil; the table selection is its target.
  { id: 'item.editInfo', label: '정보 편집', contexts: ['item'], palette: true, keywords: ['정보', '편집', '메타데이터', '저자', '제목', '고치기', 'edit', 'info'] },
  // 사본 내보내기… (design-spec 7.3, spec §7): a copy wherever the user picks, named like 기본 앱으로 열기's copy.
  {
    id: 'item.exportCopy',
    label: '사본 내보내기…',
    menu: { menu: 'file', group: 2, order: 2 },
    contexts: ['item'],
    contextMenu: { kinds: ['item'], group: 2, order: 2 },
    palette: true,
    keywords: ['내보내기', '사본', '저장', '복사', 'export', 'save'],
  },
  // 컬렉션에 추가 ▸ (spec 9.2, 9.3): one command, one row per collection (a value submenu, so no palette line of its own);
  // the menu bar, the item menu and the item panel's button file the selection, and 새 컬렉션 is the first row.
  {
    id: 'collection.addItems', label: '컬렉션에 추가', submenu: 'collections', palette: false, contexts: ['item'],
    menu: { menu: 'file', group: 2, order: 4 }, contextMenu: { kinds: ['item'], group: 3, order: 1 },
  },
  // 이 컬렉션에서 빼기 (spec 0, 9.2): out of the collection being viewed and the ones below it, so the item leaves the view.
  // The item menu does not list it elsewhere (nothing to take out of).
  {
    id: 'collection.removeItems', label: '이\u00a0컬렉션에서 빼기', palette: true, contexts: ['item'],
    menu: { menu: 'file', group: 2, order: 5 }, contextMenu: { kinds: ['item'], group: 3, order: 2, onlyWhenAvailable: true },
    keywords: ['컬렉션', '빼기', '제거', '꺼내기', 'remove'],
  },
  // The collection commands act on one collection: the one a sidebar row's menu was opened on (a right click selects it
  // first), and from the palette the one being viewed (spec 9.3). None is on the menu bar; the keyboard reaches them
  // through the palette and the tree's own keys (↩ renames).
  {
    id: 'collection.newChild', label: '새\u00a0하위 컬렉션', contexts: ['collection'], palette: true, contextMenu: { kinds: ['collection'], group: 1, order: 1 },
    keywords: ['하위', '컬렉션', '폴더', '만들기', 'subcollection', 'new'],
  },
  {
    id: 'collection.rename', label: '이름 바꾸기', paletteLabel: '컬렉션 이름 바꾸기', contexts: ['collection'], palette: true, contextMenu: { kinds: ['collection'], group: 1, order: 2 },
    keywords: ['컬렉션', '이름', '바꾸기', '고치기', 'rename'],
  },
  {
    id: 'collection.importInto', label: '이\u00a0컬렉션으로 가져오기…', contexts: ['collection'], palette: true, contextMenu: { kinds: ['collection'], group: 2, order: 1 },
    keywords: ['가져오기', '컬렉션', '추가', '사본', 'import'],
  },
  {
    id: 'collection.delete', label: '컬렉션 삭제…', contexts: ['collection'], palette: true, contextMenu: { kinds: ['collection'], group: 3, order: 1 },
    keywords: ['삭제', '지우기', '컬렉션', 'delete', 'remove'],
  },
  // 1–8 (spec 4.2): the key puts the tag at that slot on the selected items, or takes it off when every one has it. A
  // member has no placement of its own — 색 태그 ▸ is the group in SUBMENUS, which lists the slots that have a tag. The
  // palette lists a slot only while a tag holds it (paletteListed); the key itself always runs, to say a slot is empty.
  ...COLOR_SLOTS.map(colorCommand),
  // The tag chip's menu (spec 9.2): 이름 바꾸기 happens in the chip itself, 색 지정 ▸ lists the eight slots (the tag that
  // holds one is named in its row) and 색 해제 needs a colour. A tag is reached from the selector, so none of these is a
  // palette or menu-bar command.
  { id: 'tag.rename', label: '이름 바꾸기', contexts: ['tag'], contextMenu: { kinds: ['tag'], group: 1, order: 1 } },
  { id: 'tag.setColor', label: '색 지정', contexts: ['tag'], submenu: 'tagColors', palette: false, contextMenu: { kinds: ['tag'], group: 1, order: 2 } },
  { id: 'tag.clearColor', label: '색 해제', contexts: ['tag'], contextMenu: { kinds: ['tag'], group: 1, order: 3 } },
  { id: 'tag.delete', label: '태그 삭제…', contexts: ['tag'], contextMenu: { kinds: ['tag'], group: 2, order: 1 } },
  // 태그 선택 해제 (spec 4.3): the selector's "…" menu, the empty state of a filter and the palette.
  { id: 'tags.clearFilter', label: '태그 선택 해제', contexts: ['library'], palette: true, keywords: ['태그', '해제', '필터', '선택 해제', 'tag', 'filter', 'clear'] },
  {
    id: 'view.toggleSidebar', label: '사이드바 보기/가리기', accelerator: 'Ctrl+Cmd+S', menu: { menu: 'view', group: 2, order: 1 }, contexts: ['app'],
    stateLabels: { sidebar: { shown: '사이드바 가리기', hidden: '사이드바 보기' } },
    keywords: ['사이드바', '패널', '가리기', '숨기기', '보기', 'sidebar'],
  },
  // The item panel: the library only, its right slot (the reader's is the tutor's). Named by what it does now
  // (stateLabels), like the sidebar toggle.
  {
    id: 'view.toggleInspector', label: '항목 패널 보기/가리기', accelerator: 'Alt+CmdOrCtrl+I', menu: { menu: 'view', group: 2, order: 2 }, contexts: ['library'],
    stateLabels: { inspector: { shown: '항목 패널 가리기', hidden: '항목 패널 보기' } },
    keywords: ['항목 패널', '인스펙터', '정보', '패널', '가리기', '보기', 'inspector', 'info'],
  },
  // 정렬 기준 ▸ (spec 5.2): the keyboard-only sort. Its rows are the shown columns and the two directions, built by main
  // from the reported context; a pick sets the sort of the view shown. Not in the palette: a run there carries no value.
  { id: 'library.sortBy', label: '정렬 기준', menu: { menu: 'view', group: 2, order: 3 }, contexts: ['library'], submenu: 'sortColumns', palette: false },
  {
    id: 'app.shortcuts', label: '단축키 도움말', accelerator: 'CmdOrCtrl+/', menu: { menu: 'help', group: 1, order: 1 }, contexts: ['app'],
    keywords: ['단축키', '키보드', '도움말', 'shortcuts', 'keyboard'],
  },
  // ⌘, (design-spec 6 설정 창): main opens the settings window itself, so it also works when the library failed to open.
  {
    id: 'app.settings', label: '설정…', accelerator: 'CmdOrCtrl+,', menu: { menu: 'app', group: 1, order: 1 }, contexts: ['app'],
    keywords: ['설정', '환경설정', '테마', '다크', '밀도', '글자 크기', '라이브러리 위치', 'settings', 'preferences'],
  },
  // ⌘+ / ⌘− / ⌘0: the library's UI text size (design-spec 7.4 라이브러리; PDF zoom takes these keys in the reader, M7).
  { id: 'view.textBigger', label: '글자 크게', accelerator: 'CmdOrCtrl+Plus', menu: { menu: 'view', group: 3, order: 1 }, contexts: ['library'], keywords: ['글자', '크게', '확대', 'font', 'bigger'] },
  { id: 'view.textSmaller', label: '글자 작게', accelerator: 'CmdOrCtrl+-', menu: { menu: 'view', group: 3, order: 2 }, contexts: ['library'], keywords: ['글자', '작게', '축소', 'font', 'smaller'] },
  { id: 'view.textReset', label: '기본 글자 크기', accelerator: 'CmdOrCtrl+0', menu: { menu: 'view', group: 3, order: 3 }, contexts: ['library'], keywords: ['글자', '기본', 'font', 'reset'] },
  // F6 / ⇧F6 (design-spec 8.3): the renderer keymap moves the focus between panes, also out of a text field. No menu
  // item and not in the palette; the ⌘/ sheet lists them under 앱.
  { id: 'view.nextPane', label: '다음 패널로 이동', key: { code: 'F6', inText: true }, contexts: ['app'], palette: false, duringWork: true },
  { id: 'view.previousPane', label: '이전 패널로 이동', key: { code: 'F6', shift: true, inText: true }, contexts: ['app'], palette: false, duringWork: true },
  // Last (R-10): menu-bar and palette lists keep this order; `menu` puts it at the head of 보기. Not in its own list.
  { id: 'app.palette', label: '명령 팔레트…', accelerator: 'CmdOrCtrl+K', menu: { menu: 'view', group: 1, order: 1 }, contexts: ['app'], palette: false },
];

/** Every command id, in registry order: the zod enums of ipc.ts (commandIdSchema) and settings.ts (palette.recent). */
export const COMMAND_IDS = COMMANDS.map((c) => c.id) as readonly CommandId[] as readonly [CommandId, ...CommandId[]];

export function commandById(id: CommandId): CommandSpec {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown command: ${id}`);
  return c;
}

/** A command that acts on targets (items, collections, tags) is not listed by default: the palette has none to give it. */
const needsTargets = (c: CommandSpec): boolean => c.contexts.some((x) => x === 'item' || x === 'collection' || x === 'tag');
export const inPalette = (c: CommandSpec): boolean => c.palette ?? !needsTargets(c);

/** The slot (1–8) a colour key stands for, or null for any other command. */
export function tagSlot(id: CommandId): number | null {
  const m = /^tag\.color([1-8])$/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * Whether the palette lists a command now, beside inPalette and availability: a colour key only while a tag holds its slot
 * (spec 4.2) — a row for an empty slot could not do what its name says. The key itself still runs (it tells the user).
 */
export function paletteListed(spec: CommandSpec, ctx: Pick<CommandContextState, 'tagPositions'>): boolean {
  const slot = tagSlot(spec.id);
  return slot === null || hasTagPosition(ctx.tagPositions, slot);
}
/**
 * The label a menu, tooltip or palette shows: the state label when the command has one and the state is known (`state`
 * is the reported context), else the platform label.
 */
export function commandLabel(c: CommandSpec, platform: string, state: Pick<CommandContextState, 'sidebar' | 'inspector'> = {}): string {
  const labels = c.stateLabels;
  if (labels?.sidebar && state.sidebar) return labels.sidebar[state.sidebar];
  if (labels?.inspector && state.inspector) return labels.inspector[state.inspector];
  return platform !== 'darwin' && c.labelOff ? c.labelOff : c.label;
}

/** The name the palette shows: `paletteLabel` where the command has one, else what the menus call it. */
export function paletteLabel(c: CommandSpec, platform: string, state: Pick<CommandContextState, 'sidebar' | 'inspector'> = {}): string {
  return c.paletteLabel ?? commandLabel(c, platform, state);
}

/**
 * How a sentence or a hint names a command (critic T14-n2): its label without the trailing "…". The label keeps the
 * ellipsis where the command asks for more input (macOS HIG), in menus, buttons, the palette and the ⌘/ sheet; prose
 * that only names the command drops it (Apple Style Guide), and is built from the label so the two cannot drift.
 */
export function commandMention(c: CommandSpec, platform: string, state: Pick<CommandContextState, 'sidebar' | 'inspector'> = {}): string {
  return commandLabel(c, platform, state).replace(/…$/, '');
}

/** Commands main runs itself: always available, even before (or without) a renderer. */
export const MAIN_OWNED_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>(['app.settings']);

/**
 * Commands grouped into one submenu (spec 9.1): "색 태그 ▸" lists `tag.color1`–`tag.color8`. The members stay commands
 * of their own (the key map, the ⌘/ sheet and the palette need each one), so they carry no placement; the group does.
 * A group exists only with its members' handlers (a row without a handler cannot exist): the colour keys' are in R/commands/registry.ts.
 */
export interface SubmenuSpec {
  id: 'colorTags';
  /** Korean, as the menu shows it. */
  label: string;
  /** The members, in menu order. */
  commands: readonly CommandId[];
  menu?: { menu: MenuName; group: number; order: number };
  contextMenu?: { kinds: readonly ContextMenuKind[]; group: number; order: number };
}
export const SUBMENUS: readonly SubmenuSpec[] = [
  {
    id: 'colorTags',
    label: '색 태그',
    commands: COLOR_SLOTS.map(colorId),
    // 파일 group 2 after 컬렉션에 추가 ▸ (4) and 이 컬렉션에서 빼기 (5); the item menu's group 3 after the same two (1, 2).
    menu: { menu: 'file', group: 2, order: 6 },
    contextMenu: { kinds: ['item'], group: 3, order: 3 },
  },
];

/** What is wrong with the submenus of a registry (empty: nothing). The real registry must give []. */
export function submenuProblems(commands: readonly CommandSpec[], submenus: readonly SubmenuSpec[]): string[] {
  const problems: string[] = [];
  const byId = new Map(commands.map((c) => [c.id, c]));
  for (const c of commands) {
    if (c.submenu === undefined) continue;
    const source = SUBMENU_SOURCES[c.submenu];
    if (!c.menu && !c.contextMenu) problems.push(`${c.id}: a value submenu with no placement`);
    if (inPalette(c)) problems.push(`${c.id}: a value submenu listed in the palette (a palette run carries no value)`);
    if (c.menu && !source.menuBar) problems.push(`${c.id}: ${c.submenu} has no menu-bar form`);
    for (const kind of c.contextMenu?.kinds ?? []) if (!source.contextKinds.includes(kind)) problems.push(`${c.id}: ${c.submenu} does not build a${kind === 'item' ? 'n' : ''} ${kind} menu`);
  }
  const seen = new Set<string>();
  const members = new Set<CommandId>();
  for (const s of submenus) {
    if (seen.has(s.id)) problems.push(`${s.id}: listed twice`);
    seen.add(s.id);
    if (!s.menu && !s.contextMenu) problems.push(`${s.id}: no placement`);
    if (!/[가-힣]/.test(s.label)) problems.push(`${s.id}: the label is not Korean`);
    if (s.commands.length === 0) problems.push(`${s.id}: no members`);
    for (const id of s.commands) {
      const c = byId.get(id);
      if (!c) {
        problems.push(`${s.id}: ${id} is not a command`);
        continue;
      }
      if (members.has(id)) problems.push(`${id}: in two submenus`);
      members.add(id);
      if (c.menu || c.contextMenu) problems.push(`${id}: a member of ${s.id} with a placement of its own`);
    }
  }
  return problems;
}

/** What availability depends on. The main window's renderer owns it and reports it (ui:reportContext). */
export interface CommandContextState {
  view: 'library' | 'viewer';
  /** An import, a modal sheet or the fatal screen owns the window: nothing runs. */
  blocked: boolean;
  /** For state labels only (not availability): absent where the window has no sidebar (the fatal screen). */
  sidebar?: PaneShown;
  /** The item panel (library view only), for its toggle's state label; absent where there is none. */
  inspector?: PaneShown;
  /** UI text size in pt (prefs.fontSize, Task 10): ⌘+ / ⌘− stop at 15 / 12, ⌘0 only away from 13. */
  textSize: 12 | 13 | 14 | 15;
  /** Items in the library; 0 is the empty library (nothing to find or inspect). */
  libraryCount: number;
  /** The table selection as counts, so the context stays flat (sameCommandContext). */
  selectionCount: number;
  /** Of the selection: items whose file is there. */
  selectionAvailable: number;
  /** Of the selection: linked items whose file is missing (what 다시 연결… needs). */
  selectionRelinkable: number;
  /**
   * The colour slots 1–8 whose tag every selected item has, bit n−1 for slot n (0–255; 0 with nothing selected): the menu bar's
   * 색 태그 ▸ checks those rows (spec 9.2). A mask, not the tags' ids, so the context stays flat and primitive (sameCommandContext).
   */
  selectionTagPositions: number;
  /** The kind of view the table shows (spec 3.1). */
  scope: LibraryScope['kind'];
  /** Live collections (0: nothing to file into). */
  collectionCount: number;
  /** The colour slots 1–8 that have a tag, bit n−1 for slot n (0–255): the 1–8 keys and the palette need to know. */
  tagPositions: number;
  /** Tags in the sidebar's filter. */
  tagFilterCount: number;
  /** The quick search has a query. */
  searchActive: boolean;
  /** The sort of the view shown (the recent view has its own) and the columns drawn, for 보기 › 정렬 기준 (spec 5.2). */
  sortColumn: LibrarySortColumn;
  sortDirection: 'asc' | 'desc';
  /** The columns drawn, forced ones included: a bitmask over LIBRARY_COLUMN_IDS (columnsMask). */
  columnsShown: number;
}

/** The view fields of a context with no library view yet: the first report, the fatal screen, a test's fixture. */
export const NO_LIBRARY_VIEW = Object.freeze({
  selectionTagPositions: 0,
  scope: 'all',
  collectionCount: 0,
  tagPositions: 0,
  tagFilterCount: 0,
  searchActive: false,
  sortColumn: 'createdAt',
  sortDirection: 'desc',
  columnsShown: columnsMask(DEFAULT_COLUMN_CONFIG.visible),
} as const satisfies Pick<CommandContextState, 'selectionTagPositions' | 'scope' | 'collectionCount' | 'tagPositions' | 'tagFilterCount' | 'searchActive' | 'sortColumn' | 'sortDirection' | 'columnsShown'>);

/** The colour slots with a tag as a bitmask (bit n−1 = slot n); `null` and slots outside 1–8 count for nothing. */
export function tagPositionsMask(positions: Iterable<number | null>): number {
  let mask = 0;
  for (const p of positions) if (p !== null && p >= 1 && p <= 8) mask |= 1 << (p - 1);
  return mask;
}
export const hasTagPosition = (mask: number, position: number): boolean => position >= 1 && position <= 8 && (mask & (1 << (position - 1))) !== 0;

/** Same context, field by field (every field is a primitive): main skips a report that changes nothing. */
export function sameCommandContext(a: CommandContextState, b: CommandContextState): boolean {
  const ka = Object.keys(a) as Array<keyof CommandContextState>;
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
}

/** An item as a command target, as far as availability goes (fresh from disk in main's context menus). */
export interface ItemTargetInfo {
  kind: 'item';
  storageMode: StorageMode;
  availability: Availability;
}
export interface CollectionTargetInfo {
  kind: 'collection';
  id: string;
}
/** `hasColor`: 색 해제 needs a colour to clear. */
export interface TagTargetInfo {
  kind: 'tag';
  id: string;
  hasColor: boolean;
}
/** What a command acts on, by kind: the item rules read the item ones only. */
export type CommandTargetInfo = ItemTargetInfo | CollectionTargetInfo | TagTargetInfo;

/** The availability facts of an item (a list row, a freshly read item) as a target. */
export const itemTarget = (item: { storageMode: StorageMode; availability: Availability }): ItemTargetInfo => ({
  kind: 'item',
  storageMode: item.storageMode,
  availability: item.availability,
});

/**
 * What only the renderer knows, beside the reported context (never reported, so main's `blocked` stays as it is).
 * `modal`: a modal surface owns the keyboard — a sheet, the ⌘K palette, the drop overlay. `blocked` without it is work
 * in progress (an import), which stops every command but focus movement (`duringWork`).
 */
export interface CommandSurface {
  modal: boolean;
}

const AVAILABLE: ItemTargetInfo = Object.freeze({ kind: 'item', storageMode: 'managed', availability: 'available' });
const RELINKABLE: ItemTargetInfo = Object.freeze({ kind: 'item', storageMode: 'linked', availability: 'missing' });
const MISSING: ItemTargetInfo = Object.freeze({ kind: 'item', storageMode: 'managed', availability: 'missing' });

/** Targets by kind: a rule reads the kind it is about. A split array is never changed afterwards. */
export interface Targets {
  items: readonly ItemTargetInfo[];
  collections: readonly CollectionTargetInfo[];
  tags: readonly TagTargetInfo[];
}
const NO_TARGETS: Targets = Object.freeze({ items: [], collections: [], tags: [] });
/** One split per array: the menu bar judges every command on the same selection array. */
const split = new WeakMap<readonly CommandTargetInfo[], Targets>();
function targetsByKind(targets: readonly CommandTargetInfo[]): Targets {
  if (targets.length === 0) return NO_TARGETS;
  let found = split.get(targets);
  if (!found) {
    const items: ItemTargetInfo[] = [];
    const collections: CollectionTargetInfo[] = [];
    const tags: TagTargetInfo[] = [];
    for (const t of targets) {
      if (t.kind === 'item') items.push(t);
      else if (t.kind === 'collection') collections.push(t);
      else tags.push(t);
    }
    found = { items, collections, tags };
    split.set(targets, found);
  }
  return found;
}

/**
 * Synthetic targets for the menu bar: `selectionAvailable` available, then `selectionRelinkable` linked+missing, the
 * rest managed+missing. Main has only the reported counts; no rule reads the storage mode of an available target.
 * Counts that do not add up are clamped to `selectionCount`.
 */
export function selectionTargets(ctx: CommandContextState): ItemTargetInfo[] {
  const available = Math.min(ctx.selectionAvailable, ctx.selectionCount);
  const relinkable = Math.min(ctx.selectionRelinkable, ctx.selectionCount - available);
  const targets = Array.from({ length: ctx.selectionCount }, (_, i) => (i < available ? AVAILABLE : i < available + relinkable ? RELINKABLE : MISSING));
  split.set(targets, { items: targets, collections: [], tags: [] }); // items only: no pass over a selection of the whole library
  return targets;
}

type Rule = (ctx: CommandContextState, targets: Targets) => boolean;
/** The colour keys act on the library table's selection (the key map and the palette hand it over). */
const colorKey: Rule = (c, t) => c.view === 'library' && t.items.length >= 1;
const RULES: Partial<Record<CommandId, Rule>> = {
  'library.find': (c) => c.libraryCount > 0,
  // Only with a search to keep, and only from a view that narrows it (spec 7.1).
  'library.findEverywhere': (c) => c.searchActive && c.scope !== 'all',
  // An empty library has no panel (design-spec 2.4).
  'view.toggleInspector': (c) => c.libraryCount > 0,
  // The sort acts on the table, which the empty library does not have (its first-run screen replaces it).
  'library.sortBy': (c) => c.libraryCount > 0,
  // Any availability: for a missing file the reader shows its 원본 없음 notice, which is where 다시 연결… lives.
  'item.open': (_ctx, t) => t.items.length === 1,
  'item.relink': (_ctx, t) => t.items.length === 1 && t.items[0]!.storageMode === 'linked' && t.items[0]!.availability === 'missing',
  'item.showInFolder': (_ctx, t) => t.items.length === 1 && t.items[0]!.availability === 'available',
  'item.openExternally': (_ctx, t) => t.items.length === 1 && t.items[0]!.availability === 'available',
  'item.exportCopy': (_ctx, t) => t.items.length === 1 && t.items[0]!.availability === 'available',
  'item.editInfo': (c, t) => t.items.length === 1 && c.view === 'library',
  // Filing needs the selection only (any file state: the file is not touched); the library view, as the menu bar judges it.
  'collection.addItems': (c) => c.view === 'library',
  // Takes the selection out of the collection viewed and what is below it: nothing to take out of anywhere else.
  'collection.removeItems': (c) => c.view === 'library' && c.scope === 'collection',
  // One collection; the open panel needs the library the files come into.
  'collection.newChild': (_c, t) => t.collections.length === 1,
  'collection.rename': (_c, t) => t.collections.length === 1,
  'collection.importInto': (c, t) => c.view === 'library' && t.collections.length === 1,
  'collection.delete': (_c, t) => t.collections.length === 1,
  // 1–8: any slot runs on a selection — an empty one says so (spec 4.2); the palette's own filter is paletteListed.
  'tag.color1': colorKey,
  'tag.color2': colorKey,
  'tag.color3': colorKey,
  'tag.color4': colorKey,
  'tag.color5': colorKey,
  'tag.color6': colorKey,
  'tag.color7': colorKey,
  'tag.color8': colorKey,
  'tag.rename': (_c, t) => t.tags.length === 1,
  'tag.setColor': (_c, t) => t.tags.length === 1,
  'tag.clearColor': (_c, t) => t.tags.length === 1 && t.tags[0]!.hasColor,
  'tag.delete': (_c, t) => t.tags.length === 1,
  'tags.clearFilter': (c) => c.tagFilterCount > 0,
  'view.textBigger': (c) => c.textSize < 15,
  'view.textSmaller': (c) => c.textSize > 12,
  'view.textReset': (c) => c.textSize !== 13,
};

/**
 * The single availability predicate, for a spec: main (menu bar, context menus) and the renderer (palette, toolbar, keymap).
 * `surface` is the renderer's: with it, a `duringWork` command is stopped by a modal surface only; without it (main),
 * by `blocked` like every other command. A command that lists `item`, `collection` or `tag` needs a target of that kind.
 */
export function commandAvailable(spec: CommandSpec, ctx: CommandContextState, targets: readonly CommandTargetInfo[] = [], surface?: CommandSurface): boolean {
  if (MAIN_OWNED_COMMANDS.has(spec.id)) return true;
  if ((spec.duringWork && surface !== undefined) ? surface.modal : ctx.blocked) return false;
  const t = targetsByKind(targets);
  const needed = spec.contexts.includes('item') ? t.items : spec.contexts.includes('collection') ? t.collections : spec.contexts.includes('tag') ? t.tags : null;
  const inContext = needed ? needed.length > 0 : spec.contexts.includes('app') || spec.contexts.includes(ctx.view);
  return inContext && (RULES[spec.id]?.(ctx, t) ?? true);
}

/** `commandAvailable` for a registry command by id. */
export function isCommandAvailable(id: CommandId, ctx: CommandContextState, targets: readonly CommandTargetInfo[] = [], surface?: CommandSurface): boolean {
  const spec = COMMANDS.find((c) => c.id === id);
  return spec !== undefined && commandAvailable(spec, ctx, targets, surface);
}

/**
 * Menu-bar commands available in `ctx`: the placed ones, and the members of a group that is placed (they carry no
 * placement of their own). An item command is judged on the selection's synthetic targets (selectionTargets), in the
 * library view only: the renderer runs it on the selected items. `commands` and `submenus` are the registry; tests pass
 * variants (availability is the same predicate).
 */
export function availableMenuCommands(ctx: CommandContextState, commands: readonly CommandSpec[] = COMMANDS, submenus: readonly SubmenuSpec[] = SUBMENUS): CommandId[] {
  // Spec 6: the menu bar's item commands act on the library table's selection, so the reader has none.
  const targets = ctx.view === 'library' ? selectionTargets(ctx) : [];
  const grouped = new Set<CommandId>(submenus.flatMap((s) => (s.menu ? s.commands : [])));
  return commands.filter((c) => (c.menu !== undefined || grouped.has(c.id)) && commandAvailable(c, ctx, targets)).map((c) => c.id);
}
