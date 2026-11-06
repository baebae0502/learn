import type { KeySpec } from './accelerator';
import type { Availability, StorageMode } from './library';
import { DEFAULT_COLUMN_CONFIG, columnsMask, type LibrarySortColumn } from './library-columns';
import type { LibraryScope } from './organize';
import type { ScrollModeName } from './reading';
import { SUBMENUS, type SubmenuSource, type SubmenuSpec } from './submenus';
import { COLOR_SLOTS } from './tag-colors';

// The submenu definitions live in submenus.ts and the colour slots in tag-colors.ts; every import of them from here keeps working.
export * from './submenus';
export { COLOR_SLOTS } from './tag-colors';

/**
 * Single command registry (ADR-0005): the menu bar, ⌘K palette, native context menus, toolbar tooltips and the
 * shortcut sheet all render from it, and one predicate (isCommandAvailable) decides what can run.
 * No zod: the sandboxed preload imports this file (type imports only).
 */
export type CommandId =
  | 'file.importManaged'
  | 'file.importLinked'
  | 'file.backup'
  | 'file.restore'
  | 'file.checkLibrary'
  | 'file.cancelImport'
  | 'library.find'
  | 'library.findEverywhere'
  | 'nav.back'
  | 'nav.historyBack'
  | 'nav.historyForward'
  | 'item.open'
  | 'item.openInBackground'
  | 'tab.close'
  | 'tab.reopenClosed'
  | 'tab.next'
  | 'tab.previous'
  | 'tab.goTo2'
  | 'tab.goTo3'
  | 'tab.goTo4'
  | 'tab.goTo5'
  | 'tab.goTo6'
  | 'tab.goTo7'
  | 'tab.goTo8'
  | 'tab.last'
  | 'tab.moveLeft'
  | 'tab.moveRight'
  | 'tab.closeOthers'
  | 'tab.revealInLibrary'
  | 'item.showInFolder'
  | 'item.openExternally'
  | 'item.editInfo'
  | 'item.exportCopy'
  | 'item.trash'
  | 'item.restore'
  | 'collection.addItems'
  | 'collection.removeItems'
  | 'item.relink'
  | 'collection.new'
  | 'collection.newChild'
  | 'collection.rename'
  | 'collection.importInto'
  | 'collection.delete'
  | 'duplicates.keepOne'
  | 'duplicates.keepOneAll'
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
  | 'translation.translateSelection'
  | 'app.shortcuts'
  | 'app.palette'
  | 'app.settings'
  | 'view.textBigger'
  | 'view.textSmaller'
  | 'view.textReset'
  | 'trash.empty'
  | 'view.nextPane'
  | 'view.previousPane'
  | 'library.sortBy'
  | 'reader.zoomAuto'
  | 'reader.zoomPageWidth'
  | 'reader.zoomPageFit'
  | 'reader.rotateCw'
  | 'reader.rotateCcw'
  | 'reader.goToPage'
  | 'reader.findNext'
  | 'reader.findPrevious'
  | 'reader.findSelection'
  | 'reader.showThumbnails'
  | 'reader.showOutline'
  | 'reader.pageColorAuto'
  | 'reader.pageColorOriginal'
  | 'reader.pageColorSepia'
  | 'reader.pageColorDark'
  | 'reader.scrollVertical'
  | 'reader.scrollHorizontal'
  | 'reader.scrollPage'
  | 'reader.spreadNone'
  | 'reader.spreadOdd'
  | 'reader.spreadEven';

/** The colour of a PDF page (settings 'reader.pageColor'): 자동 follows the app theme. */
export const PAGE_COLORS = ['auto', 'original', 'sepia', 'dark'] as const;
export type PageColor = (typeof PAGE_COLORS)[number];
/** What the reader's sidebar lists (settings 'reader.nav'). */
export const READER_NAVS = ['thumbnails', 'outline'] as const;
export type ReaderNav = (typeof READER_NAVS)[number];

/**
 * `app`: anywhere in the main window; `library` / `viewer`: the current view; `item` / `collection` / `tag` / `trash`: needs a
 * target of that kind (judged on the targets handed in; the first of these a command lists decides). `trash` is the trash
 * view's rows (P-10): a command that lists it takes trash rows in the trash view, and its other kind elsewhere (⌘⌫).
 */
export type CommandContext = 'app' | 'library' | 'viewer' | 'item' | 'collection' | 'tag' | 'trash';
/** `app` is the macOS application menu (Linux/Windows put those items at the end of 파일); `help` is 도움말. */
export type MenuName = 'app' | 'file' | 'edit' | 'view' | 'go' | 'window' | 'help';
export const CONTEXT_MENU_KINDS = ['item', 'collection', 'tag', 'column', 'trash', 'tab'] as const;
/** Native context menus (ADR-0005 §4): items, collections, tags, table column headers, the trash's rows and a reader tab. */
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
  stateLabels?: {
    sidebar?: Readonly<Record<PaneShown, string>>;
    inspector?: Readonly<Record<PaneShown, string>>;
    /** By the view shown (P-11): ⌘⌫ is 영구 삭제… in the trash; a view without an entry keeps `label`. */
    scope?: Readonly<Partial<Record<LibraryScope['kind'], string>>>;
    /** By the view shown (P-9): ⌘+ ⌘− ⌘0 size the library's text and zoom the reader's page, one command per key. */
    view?: Readonly<Record<'library' | 'viewer', string>>;
  };
  /** Label off macOS when the macOS one names a macOS app (Finder). */
  labelOff?: string;
  /**
   * The name the ⌘K palette shows when the menu around the command gives it a noun the palette lacks (spec 9.3): the
   * collection menu says 이름 바꾸기, the palette 컬렉션 이름 바꾸기, so it is not taken for a tag's.
   */
  paletteLabel?: string;
  /**
   * A name with the number it acts on (중복 N묶음 모두 정리, spec 11.1): the palette and the view's button say how many
   * once the context reports it; `label` is the name without the number. `selection`: the name when several items are
   * selected (탭 N개로 열기).
   */
  countLabel?: { duplicateGroups?: (n: number) => string; selection?: (n: number) => string };
  /** Electron accelerator, owned by the native menu. */
  accelerator?: string;
  /** Single-key shortcut, matched by physical key in the renderer keymap. */
  key?: KeySpec;
  /** `hidden`: a menu item that is not drawn but keeps its key (⌘2…⌘9 in 윈도우); only the 윈도우 menu has such items. */
  menu?: { menu: MenuName; group: number; order: number; hidden?: true };
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

/** ⌘2…⌘8: the second to the eighth tab (⌘1 is the library, ⌘9 the last). */
const TAB_NUMBERS = [2, 3, 4, 5, 6, 7, 8] as const;
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
  // 가져오기 취소 (spec 11.1): the progress toast's 취소 from the palette, while the import queue has files to finish.
  { id: 'file.cancelImport', label: '가져오기 취소', contexts: ['app'], palette: true, keywords: ['가져오기', '취소', '중지', '멈추기', 'import', 'cancel', 'stop'] },
  // 새 컬렉션 (spec 3.4): Finder's new folder — the sidebar makes the row and names it in place. 파일 group 1 after the
  // imports; the palette lists it too. Wherever the library shows, also while it is empty.
  {
    id: 'collection.new', label: '새\u00a0컬렉션', accelerator: 'Shift+CmdOrCtrl+N', menu: { menu: 'file', group: 1, order: 3 }, contexts: ['library'],
    keywords: ['컬렉션', '폴더', '만들기', '새로 만들기', 'collection', 'folder', 'new'],
  },
  // 라이브러리 점검… (spec 7.1, 11.1, 11.2): checks again and opens the sheet, also when nothing is wrong. 파일's third group;
  // 백업 만들기… and 백업에서 복원… join it (Task 9, 10).
  {
    id: 'file.checkLibrary', label: '라이브러리 점검…', menu: { menu: 'file', group: 3, order: 1 }, contexts: ['app'],
    keywords: ['점검', '검사', '복구', '정리', '임시 파일', '사본', '수정본', 'check', 'repair', 'recovery'],
  },
  // 백업 만들기… (spec 8.1, 11): main asks for a folder and runs the backup on its work line; the window stays in use.
  // 파일 group 3 after 라이브러리 점검…, and the palette. Off with nothing to back up and while a backup is on the line.
  {
    id: 'file.backup', label: '백업 만들기…', menu: { menu: 'file', group: 3, order: 2 }, contexts: ['app'],
    keywords: ['백업', '보관', '복사본', '저장', 'backup'],
  },
  // 백업에서 복원… (spec 9.1, 11): main asks for a backup and a place and restores into a new folder there, on its work line;
  // the library in use is never touched. 파일 group 3 after 백업 만들기…, and the palette. Off while a restore is on the line.
  {
    id: 'file.restore', label: '백업에서 복원…', menu: { menu: 'file', group: 3, order: 3 }, contexts: ['app'],
    keywords: ['복원', '백업', '되돌리기', '불러오기', 'restore'],
  },
  // ⌘F (design-spec 7.4 라이브러리, 7.1: instead of type-ahead): the toolbar's quick search field takes the focus with
  // its text selected. 편집 › after the system's items; the empty library has no field, so nothing to find there.
  {
    id: 'library.find', label: '빠른 검색', stateLabels: { view: { library: '빠른 검색', viewer: '찾기' } }, accelerator: 'CmdOrCtrl+F',
    menu: { menu: 'edit', group: 1, order: 1 }, contexts: ['library', 'viewer'],
    keywords: ['검색', '찾기', 'search', 'find'],
  },
  // 찾기 in the reader (M7a): ⌘F above is its find bar; these keys go on in the PDF's text and are off without a PDF.
  {
    id: 'reader.findNext', label: '다음 찾기', accelerator: 'CmdOrCtrl+G', menu: { menu: 'edit', group: 1, order: 2 }, contexts: ['viewer'],
    keywords: ['찾기', '검색', '다음', 'find next'],
  },
  {
    id: 'reader.findPrevious', label: '이전 찾기', accelerator: 'Shift+CmdOrCtrl+G', menu: { menu: 'edit', group: 1, order: 3 }, contexts: ['viewer'],
    keywords: ['찾기', '검색', '이전', 'find previous'],
  },
  {
    id: 'reader.findSelection', label: '선택한 글로 찾기', accelerator: 'CmdOrCtrl+E', menu: { menu: 'edit', group: 1, order: 4 }, contexts: ['viewer'],
    keywords: ['찾기', '검색', '선택', '선택한 글', 'use selection for find'],
  },
  // 내 라이브러리 전체에서 찾기 (spec 7.1): the no-results state's second button and a palette command — the view returns to
  // 내 라이브러리 and the query stays. No menu bar item, key or context menu: the design spec draws none for it.
  {
    id: 'library.findEverywhere', label: '내 라이브러리 전체에서 찾기', contexts: ['library'],
    keywords: ['전체', '검색', '찾기', '라이브러리', '범위', 'search', 'everywhere', 'all'],
  },
  {
    id: 'nav.back', label: '라이브러리', accelerator: 'CmdOrCtrl+1', menu: { menu: 'go', group: 1, order: 1 }, contexts: ['viewer'],
    keywords: ['라이브러리', '뒤로', '목록', 'library', 'back'],
  },
  // ⌘[ / ⌘] (design-spec 7.4): the open PDF's own back and forward — where a link, the outline, a thumbnail or the page field took it from.
  {
    id: 'nav.historyBack', label: '뒤로', accelerator: 'CmdOrCtrl+[', menu: { menu: 'go', group: 2, order: 1 }, contexts: ['viewer'],
    keywords: ['뒤로', '이전', '기록', 'back', 'history'],
  },
  {
    id: 'nav.historyForward', label: '앞으로', accelerator: 'CmdOrCtrl+]', menu: { menu: 'go', group: 2, order: 2 }, contexts: ['viewer'],
    keywords: ['앞으로', '다음', '기록', 'forward', 'history'],
  },
  // ⌥⌘G (design-spec 7.4 리더): the toolbar's page field takes the focus with its number selected.
  {
    id: 'reader.goToPage', label: '쪽으로 이동…', accelerator: 'Alt+CmdOrCtrl+G', menu: { menu: 'go', group: 1, order: 2 }, contexts: ['viewer'],
    keywords: ['쪽', '이동', '페이지', '번호', '가기', 'page', 'go to'],
  },
  { id: 'item.relink', label: '다시 연결…', contexts: ['item'], contextMenu: { kinds: ['item'], group: 0, order: 1, onlyWhenAvailable: true } },
  // ↩ and a double-click: the item's tab, or a new one right of the shown tab; several items open as several tabs (spec 3.3).
  { id: 'item.open', label: '열기', countLabel: { selection: (n) => `탭 ${n}개로 열기` }, contexts: ['item'], contextMenu: { kinds: ['item'], group: 1, order: 1 } },
  // ⌘↩: the same in the background — the shown tab stays. 파일's item group opens with it; the item menu has it under 열기.
  {
    id: 'item.openInBackground', label: '새\u00a0탭에서 열기', countLabel: { selection: (n) => `새\u00a0탭 ${n}개로 열기` }, accelerator: 'CmdOrCtrl+Enter',
    menu: { menu: 'file', group: 2, order: 0 }, contexts: ['item'], contextMenu: { kinds: ['item'], group: 1, order: 2 },
  },
  // ⌘W closes the shown reader tab (the library's tab closes the window); ⇧⌘W, the window's own role, always closes the window.
  // Last in 파일, above 창 닫기, and after 설정… where that joins 파일 (group 95). The tab menu runs it on the tab it was opened on.
  {
    id: 'tab.close', label: '탭 닫기', accelerator: 'CmdOrCtrl+W', menu: { menu: 'file', group: 95, order: 1 }, contexts: ['app'],
    contextMenu: { kinds: ['tab'], group: 1, order: 1 }, keywords: ['탭', '닫기', '끄기', 'tab', 'close'],
  },
  {
    id: 'tab.reopenClosed', label: '닫은 탭 다시 열기', accelerator: 'Shift+CmdOrCtrl+T', menu: { menu: 'file', group: 95, order: 2 }, contexts: ['app'],
    keywords: ['탭', '닫은', '다시', '열기', '복구', 'tab', 'reopen', 'undo close'],
  },
  // ⌃⇥ / ⌃⇧⇥ go round through the library tab; ⌘2…⌘8 and ⌘9 are 윈도우's hidden items (the menu lists no tabs).
  {
    id: 'tab.next', label: '다음 탭', accelerator: 'Ctrl+Tab', menu: { menu: 'window', group: 2, order: 1 }, contexts: ['app'],
    keywords: ['탭', '다음', 'next tab'],
  },
  {
    id: 'tab.previous', label: '이전 탭', accelerator: 'Ctrl+Shift+Tab', menu: { menu: 'window', group: 2, order: 2 }, contexts: ['app'],
    keywords: ['탭', '이전', 'previous tab'],
  },
  ...TAB_NUMBERS.map((n): CommandSpec => ({
    id: `tab.goTo${n}` as CommandId, label: `${n}번째 탭`, accelerator: `CmdOrCtrl+${n}`, menu: { menu: 'window', group: 2, order: n + 1, hidden: true }, contexts: ['app'], palette: false,
  })),
  { id: 'tab.last', label: '마지막 탭', accelerator: 'CmdOrCtrl+9', menu: { menu: 'window', group: 2, order: 10, hidden: true }, contexts: ['app'], palette: false },
  // ⌥⇧← / ⌥⇧→ are the tab strip's keys while a tab has the focus (the strip handles them); the palette moves the shown tab.
  { id: 'tab.moveLeft', label: '탭을 왼쪽으로 옮기기', contexts: ['app'], keywords: ['탭', '왼쪽', '옮기기', '순서', 'tab', 'move left'] },
  { id: 'tab.moveRight', label: '탭을 오른쪽으로 옮기기', contexts: ['app'], keywords: ['탭', '오른쪽', '옮기기', '순서', 'tab', 'move right'] },
  { id: 'tab.closeOthers', label: '다른\u00a0탭 닫기', contexts: ['app'], contextMenu: { kinds: ['tab'], group: 1, order: 2 }, palette: false },
  { id: 'tab.revealInLibrary', label: '라이브러리에서 보기', contexts: ['app'], contextMenu: { kinds: ['tab'], group: 2, order: 0 }, palette: false },
  // ⇧⌘R (design-spec 7.4 라이브러리): 파일 › and the item menu act on the one selected row; the menu bar judges the
  // reported selection counts, so it greys with no selection, several, or a missing file (and in the reader).
  {
    id: 'item.showInFolder', label: 'Finder에서 보기', labelOff: '폴더에서 보기', accelerator: 'Shift+CmdOrCtrl+R', menu: { menu: 'file', group: 2, order: 1 },
    contexts: ['item'], contextMenu: { kinds: ['item', 'tab'], group: 2, order: 1 }, palette: true,
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
  // 휴지통으로 이동 ⌘⌫ (spec 4.1, 11.1): at once, with 실행 취소 in the toast. In the trash view the same line is 영구 삭제…
  // (P-11): one key, one id, named by the view — the registry allows no second ⌘⌫ in one context. 파일's last group, the
  // item menu's last line; the trash rows' menu after 복원.
  {
    id: 'item.trash', label: '휴지통으로 이동', stateLabels: { scope: { trash: '영구 삭제…' } }, accelerator: 'CmdOrCtrl+Backspace',
    menu: { menu: 'file', group: 4, order: 2 }, contexts: ['item', 'trash'], contextMenu: { kinds: ['item', 'trash'], group: 4, order: 1 }, palette: true,
    keywords: ['휴지통', '삭제', '지우기', '버리기', '영구 삭제', 'trash', 'delete', 'remove'],
  },
  // 복원 (spec 4.4): the trash rows' menu and the palette; the item panel and the reader's notice have its button.
  {
    id: 'item.restore', label: '복원', contexts: ['trash'], contextMenu: { kinds: ['trash'], group: 1, order: 1 }, palette: true,
    keywords: ['복원', '되살리기', '되돌리기', '휴지통', 'restore', 'put back'],
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
  // 휴지통으로 이동 (spec 4.2, 11.1): no sheet — the toast's 실행 취소 brings it back. The id stays (nothing stores it, and a new
  // one would gain nothing). The palette names the collection: the items' ⌘⌫ has the same verb.
  {
    id: 'collection.delete', label: '휴지통으로 이동', paletteLabel: '컬렉션을 휴지통으로 이동', contexts: ['collection'], palette: true,
    contextMenu: { kinds: ['collection'], group: 3, order: 1 },
    keywords: ['휴지통', '삭제', '지우기', '컬렉션', 'trash', 'delete', 'remove'],
  },
  // 중복 정리 (M6 spec 5, 11.1): in each group the earliest import stays with the others' collections and tags, and the others
  // go to the trash at once; the toast undoes both. 하나만 남기고 휴지통으로 is the 중복 항목 row menu's (absent elsewhere),
  // next to 휴지통으로 이동 at the menu's end (what moves to the trash comes last, design-spec 7.3); 모두 정리 is the view's
  // own button. Both in the palette, neither on the menu bar.
  {
    id: 'duplicates.keepOne', label: '하나만 남기고 휴지통으로', contexts: ['item'], palette: true,
    contextMenu: { kinds: ['item'], group: 4, order: 0, onlyWhenAvailable: true },
    keywords: ['중복', '정리', '하나만', '남기기', '휴지통', 'duplicate', 'dedupe'],
  },
  {
    id: 'duplicates.keepOneAll', label: '중복 묶음 모두 정리', countLabel: { duplicateGroups: (n) => `중복 ${n}묶음 모두 정리` }, contexts: ['library'],
    keywords: ['중복', '정리', '모두', '묶음', '휴지통', 'duplicate', 'dedupe'],
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
  // The item panel: the library's, and the reader's while a PDF is open. Named by what it does now (stateLabels), like the sidebar toggle.
  {
    id: 'view.toggleInspector', label: '항목 패널 보기/가리기', accelerator: 'Alt+CmdOrCtrl+I', menu: { menu: 'view', group: 2, order: 2 }, contexts: ['library', 'viewer'],
    stateLabels: { inspector: { shown: '항목 패널 가리기', hidden: '항목 패널 보기' } },
    keywords: ['항목 패널', '인스펙터', '정보', '패널', '가리기', '보기', 'inspector', 'info'],
  },
  // The selection pop-up's command (M7a): no menu item, no key; the palette offers it while a PDF text is selected.
  {
    id: 'translation.translateSelection', label: '선택한 글 번역', contexts: ['viewer'],
    keywords: ['번역', 'translate', '선택', '선택한 글'],
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
  // In the reader the same keys zoom the page (P-9): the menu bar is one for every view and each key belongs to one command,
  // so the command is named by the view (stateLabels.view) and its handler acts by it.
  {
    id: 'view.textBigger', label: '글자 크게', stateLabels: { view: { library: '글자 크게', viewer: '확대' } }, accelerator: 'CmdOrCtrl+Plus',
    menu: { menu: 'view', group: 3, order: 1 }, contexts: ['library', 'viewer'], keywords: ['글자', '크게', '확대', '키우기', '줌', 'font', 'bigger', 'zoom in'],
  },
  {
    id: 'view.textSmaller', label: '글자 작게', stateLabels: { view: { library: '글자 작게', viewer: '축소' } }, accelerator: 'CmdOrCtrl+-',
    menu: { menu: 'view', group: 3, order: 2 }, contexts: ['library', 'viewer'], keywords: ['글자', '작게', '축소', '줄이기', '줌', 'font', 'smaller', 'zoom out'],
  },
  {
    id: 'view.textReset', label: '기본 글자 크기', stateLabels: { view: { library: '기본 글자 크기', viewer: '실제 크기' } }, accelerator: 'CmdOrCtrl+0',
    menu: { menu: 'view', group: 3, order: 3 }, contexts: ['library', 'viewer'], keywords: ['글자', '기본', '실제 크기', '100%', '배율', 'font', 'reset', 'actual size'],
  },
  // The reader's own view commands (M7a): they act on the open PDF, so a video or no document greys them (pdfOpen).
  // 보기 group 4 is how the page fits, group 5 turns it and colours it.
  {
    id: 'reader.zoomAuto', label: '자동 맞춤', menu: { menu: 'view', group: 4, order: 1 }, contexts: ['viewer'],
    keywords: ['확대', '배율', '맞춤', '자동', '창 크기', 'zoom', 'auto', 'fit'],
  },
  {
    id: 'reader.zoomPageWidth', label: '너비에 맞춤', menu: { menu: 'view', group: 4, order: 2 }, contexts: ['viewer'],
    keywords: ['확대', '배율', '너비', '폭', '맞춤', 'zoom', 'width', 'fit'],
  },
  {
    id: 'reader.zoomPageFit', label: '한 쪽 전체 보기', menu: { menu: 'view', group: 4, order: 3 }, contexts: ['viewer'],
    keywords: ['확대', '배율', '한 쪽', '쪽 전체', '맞춤', 'zoom', 'page fit', 'whole page'],
  },
  {
    id: 'reader.rotateCw', label: '시계 방향으로 회전', accelerator: 'CmdOrCtrl+R', menu: { menu: 'view', group: 5, order: 1 }, contexts: ['viewer'],
    keywords: ['회전', '돌리기', '오른쪽', '시계', 'rotate', 'clockwise'],
  },
  {
    id: 'reader.rotateCcw', label: '반시계 방향으로 회전', accelerator: 'CmdOrCtrl+L', menu: { menu: 'view', group: 5, order: 2 }, contexts: ['viewer'],
    keywords: ['회전', '돌리기', '왼쪽', '반시계', 'rotate', 'counterclockwise'],
  },
  // The reader's sidebar shows thumbnails or the outline (보기 group 2, after the library's pane commands).
  {
    id: 'reader.showThumbnails', label: '썸네일 보기', accelerator: 'Alt+CmdOrCtrl+2', menu: { menu: 'view', group: 2, order: 4 }, contexts: ['viewer'],
    keywords: ['썸네일', '미리보기', '쪽 목록', '사이드바', 'thumbnails', 'pages'],
  },
  {
    id: 'reader.showOutline', label: '목차 보기', accelerator: 'Alt+CmdOrCtrl+3', menu: { menu: 'view', group: 2, order: 5 }, contexts: ['viewer'],
    keywords: ['목차', '차례', '장', '절', '사이드바', 'outline', 'contents', 'table of contents'],
  },
  // 쪽 색 ▸ is one group in SUBMENUS (P-14): the four members carry no placement, the group holds it. The palette names each
  // one with the group's word.
  ...(
    [
      ['Auto', '앱 테마 따르기', ['테마', '자동', '다크', 'auto', 'theme']],
      ['Original', '원본', ['원래', '흰색', '흰 배경', 'original', 'white']],
      ['Sepia', '세피아', ['갈색', '따뜻한', '눈 편한', 'sepia']],
      ['Dark', '어둡게', ['다크', '검정', '밤', '반전', 'dark', 'night']],
    ] as const
  ).map(
    ([name, label, extra]): CommandSpec => ({
      id: `reader.pageColor${name}` as CommandId,
      label,
      paletteLabel: `쪽 색: ${label}`,
      contexts: ['viewer'],
      keywords: ['쪽 색', '색', '배경', '종이', 'page color', ...extra],
    }),
  ),
  // 스크롤 ▸ and 펼침 ▸ are groups in SUBMENUS like 쪽 색 ▸: the members carry no placement and no key, the groups hold them.
  // The palette names each one with its group's word.
  ...(
    [
      ['scrollVertical', '세로로 이어서', '스크롤', ['세로', '위아래', '이어서', 'vertical']],
      ['scrollHorizontal', '가로로 이어서', '스크롤', ['가로', '옆으로', '좌우', 'horizontal']],
      ['scrollPage', '한 쪽씩', '스크롤', ['쪽', '한 장씩', '페이지', '넘기기', 'page', 'single']],
      ['spreadNone', '펼치지 않음', '펼침', ['한 쪽', '낱장', 'none', 'single']],
      ['spreadOdd', '홀수 쪽부터', '펼침', ['두 쪽', '양면', '책', '홀수', 'odd', 'book']],
      ['spreadEven', '짝수 쪽부터', '펼침', ['두 쪽', '양면', '책', '짝수', 'even']],
    ] as const
  ).map(
    ([name, label, group, extra]): CommandSpec => ({
      id: `reader.${name}` as CommandId,
      label,
      paletteLabel: `${group}: ${label}`,
      contexts: ['viewer'],
      keywords: [group, '보기', '모드', 'scroll', 'spread', ...extra],
    }),
  ),
  // 휴지통 비우기… ⇧⌘⌫ (spec 4.5, 11.1): 파일 before ⌘⌫ and the trash view's head; the purge sheet asks first.
  {
    id: 'trash.empty', label: '휴지통 비우기…', accelerator: 'Shift+CmdOrCtrl+Backspace', menu: { menu: 'file', group: 4, order: 1 }, contexts: ['library'],
    keywords: ['휴지통', '비우기', '영구 삭제', 'empty trash'],
  },
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
const needsTargets = (c: CommandSpec): boolean => c.contexts.some((x) => x === 'item' || x === 'collection' || x === 'tag' || x === 'trash');
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
export function paletteListed(spec: CommandSpec, ctx: Pick<CommandContextState, 'tagPositions'> & Partial<Pick<CommandContextState, 'view'>>): boolean {
  // 탭 닫기 on the library tab closes the window: the palette, which is read by name, offers it only where a reader tab is shown.
  if (spec.id === 'tab.close') return ctx.view === 'viewer';
  const slot = tagSlot(spec.id);
  return slot === null || hasTagPosition(ctx.tagPositions, slot);
}
/** What a state label follows: the pane states and the view's scope, as reported (absent ones name nothing). */
export type LabelState = Partial<Pick<CommandContextState, 'sidebar' | 'inspector' | 'scope' | 'duplicateGroups' | 'view' | 'selectionCount'>>;

/**
 * The label a menu, tooltip or palette shows: the state label when the command has one and the state is known (`state`
 * is the reported context), else the platform label.
 */
export function commandLabel(c: CommandSpec, platform: string, state: LabelState = {}): string {
  const labels = c.stateLabels;
  if (labels?.sidebar && state.sidebar) return labels.sidebar[state.sidebar];
  if (labels?.inspector && state.inspector) return labels.inspector[state.inspector];
  const scoped = labels?.scope && state.scope ? labels.scope[state.scope] : undefined;
  if (scoped !== undefined) return scoped;
  if (labels?.view && state.view) return labels.view[state.view];
  if (c.countLabel?.selection && state.selectionCount !== undefined && state.selectionCount > 1) return c.countLabel.selection(state.selectionCount);
  if (c.countLabel?.duplicateGroups && state.duplicateGroups !== undefined && state.duplicateGroups > 0) return c.countLabel.duplicateGroups(state.duplicateGroups);
  return platform !== 'darwin' && c.labelOff ? c.labelOff : c.label;
}

/** The name the palette shows: `paletteLabel` where the command has one, else what the menus call it. */
export function paletteLabel(c: CommandSpec, platform: string, state: LabelState = {}): string {
  return c.paletteLabel ?? commandLabel(c, platform, state);
}

/**
 * How a sentence or a hint names a command (critic T14-n2): its label without the trailing "…". The label keeps the
 * ellipsis where the command asks for more input (macOS HIG), in menus, buttons, the palette and the ⌘/ sheet; prose
 * that only names the command drops it (Apple Style Guide), and is built from the label so the two cannot drift.
 */
export function commandMention(c: CommandSpec, platform: string, state: LabelState = {}): string {
  return commandLabel(c, platform, state).replace(/…$/, '');
}

/** Commands main runs itself: always available, even before (or without) a renderer. */
export const MAIN_OWNED_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>(['app.settings']);

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
  /** Trashed items and collection rows (OrganizeSnapshot.trashCount): 휴지통 비우기 needs one (P-10). */
  trashCount: number;
  /** A PDF is open and its pages exist (the reader's view commands and ⌘+ ⌘− ⌘0 there need it): absent in the library, for a video and while a PDF opens. */
  pdfOpen?: boolean;
  /** How the open PDF scrolls: 펼침 is off while it is 'horizontal'. Absent with no PDF open. */
  pdfScroll?: ScrollModeName;
  /** The open PDF has a place to go back to / forward to (⌘[ ⌘]): absent otherwise. */
  historyBack?: boolean;
  historyForward?: boolean;
  /** Text of the open PDF is selected (the reader's selection pop-up has something to translate): 선택한 글 번역. Absent otherwise. */
  pdfSelection?: boolean;
  /** Translation is switched off (the choice is made and it is no): 선택한 글 번역 does nothing then. Absent while on or not yet chosen (running it asks). */
  translationOff?: boolean;
  /** The import queue has files to finish (its progress toast is up or about to be): 가져오기 취소. Absent where nothing imports. */
  importRunning?: boolean;
  /** A backup is on main's work line, running or waiting (job:progress): 백업 만들기… is off until it ends. */
  backupRunning?: boolean;
  /** A restore is on main's work line, running or waiting (job:progress): 백업에서 복원… is off until it ends. */
  restoreRunning?: boolean;
  /**
   * Duplicate groups with two or more items in the list (spec 11.1): 중복 N묶음 모두 정리 needs two, and its name says how
   * many. Absent where no library view reports it.
   */
  duplicateGroups?: number;
  /** Reader tabs open (the library tab is not counted): the tab commands that switch, close the others or move need some. Absent with none. */
  tabCount?: number;
  /** Some closed tab's item can be opened again (not in the trash, not deleted): ⇧⌘T. Absent otherwise. */
  closedOpenable?: boolean;
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
  trashCount: 0,
} as const satisfies Pick<CommandContextState, 'selectionTagPositions' | 'scope' | 'collectionCount' | 'tagPositions' | 'tagFilterCount' | 'searchActive' | 'sortColumn' | 'sortDirection' | 'columnsShown' | 'trashCount'>);

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
  /** The item is in the trash (only a tab can be about one): 라이브러리에서 보기 has no row to show then. */
  trashed?: true;
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
/** A row of the trash view (P-10): what 복원 and 영구 삭제… act on. Its kind (item or collection) is the handler's, not availability's. */
export interface TrashTargetInfo {
  kind: 'trash';
}
export const TRASH_TARGET: TrashTargetInfo = Object.freeze({ kind: 'trash' });
/** What a command acts on, by kind: the item rules read the item ones only. */
export type CommandTargetInfo = ItemTargetInfo | CollectionTargetInfo | TagTargetInfo | TrashTargetInfo;

/** The availability facts of an item (a list row, a freshly read item) as a target. */
export const itemTarget = (item: { storageMode: StorageMode; availability: Availability; trashed?: boolean }): ItemTargetInfo => ({
  kind: 'item',
  storageMode: item.storageMode,
  availability: item.availability,
  ...(item.trashed ? { trashed: true as const } : {}),
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
  trash: readonly TrashTargetInfo[];
}
const NO_TARGETS: Targets = Object.freeze({ items: [], collections: [], tags: [], trash: [] });
/** One split per array: the menu bar judges every command on the same selection array. */
const split = new WeakMap<readonly CommandTargetInfo[], Targets>();
function targetsByKind(targets: readonly CommandTargetInfo[]): Targets {
  if (targets.length === 0) return NO_TARGETS;
  let found = split.get(targets);
  if (!found) {
    const items: ItemTargetInfo[] = [];
    const collections: CollectionTargetInfo[] = [];
    const tags: TagTargetInfo[] = [];
    const trash: TrashTargetInfo[] = [];
    for (const t of targets) {
      if (t.kind === 'item') items.push(t);
      else if (t.kind === 'collection') collections.push(t);
      else if (t.kind === 'tag') tags.push(t);
      else trash.push(t);
    }
    found = { items, collections, tags, trash };
    split.set(targets, found);
  }
  return found;
}

/**
 * Synthetic targets for the menu bar: `selectionAvailable` available, then `selectionRelinkable` linked+missing, the
 * rest managed+missing. In the trash view the selection is trash rows (P-10). Main has only the reported counts; no rule
 * reads the storage mode of an available target. Counts that do not add up are clamped to `selectionCount`.
 */
export function selectionTargets(ctx: CommandContextState): CommandTargetInfo[] {
  if (ctx.scope === 'trash') {
    const rows = Array.from({ length: ctx.selectionCount }, (): TrashTargetInfo => TRASH_TARGET);
    split.set(rows, { items: [], collections: [], tags: [], trash: rows });
    return rows;
  }
  const available = Math.min(ctx.selectionAvailable, ctx.selectionCount);
  const relinkable = Math.min(ctx.selectionRelinkable, ctx.selectionCount - available);
  const targets = Array.from({ length: ctx.selectionCount }, (_, i) => (i < available ? AVAILABLE : i < available + relinkable ? RELINKABLE : MISSING));
  split.set(targets, { items: targets, collections: [], tags: [], trash: [] }); // items only: no pass over a selection of the whole library
  return targets;
}

type Rule = (ctx: CommandContextState, targets: Targets) => boolean;
/** The colour keys act on the library table's selection (the key map and the palette hand it over). */
const colorKey: Rule = (c, t) => c.view === 'library' && t.items.length >= 1;
const pdfOpen: Rule = (c) => c.pdfOpen === true;
/** A horizontal scroll has no spreads (two pages side by side along a row are hard to read), so the three are off then. */
const spreadAllowed: Rule = (c) => c.pdfOpen === true && c.pdfScroll !== 'horizontal';
/** Tab number `n` (1 is the library) exists: reader tabs are numbered from 2. */
const hasTab = (n: number): Rule => (c) => (c.tabCount ?? 0) >= n - 1;
const RULES: Partial<Record<CommandId, Rule>> = {
  'library.find': (c) => (c.view === 'viewer' ? c.pdfOpen === true : c.libraryCount > 0),
  'reader.findNext': pdfOpen,
  'reader.findPrevious': pdfOpen,
  'reader.findSelection': pdfOpen,
  'reader.showThumbnails': pdfOpen,
  'reader.showOutline': pdfOpen,
  // Only with a search to keep, and only from a view that narrows it (spec 7.1).
  'library.findEverywhere': (c) => c.searchActive && c.scope !== 'all',
  // An empty library has no panel (design-spec 2.4).
  'view.toggleInspector': (c) => (c.view === 'viewer' ? c.pdfOpen === true : c.libraryCount > 0),
  'translation.translateSelection': (c) => c.pdfOpen === true && c.pdfSelection === true && c.translationOff !== true,
  // The sort acts on the table, which the empty library does not have (its first-run screen replaces it).
  'library.sortBy': (c) => c.libraryCount > 0,
  // Any availability: for a missing file the reader shows its 원본 없음 notice, which is where 다시 연결… lives.
  'item.open': (_ctx, t) => t.items.length >= 1,
  // The library's selection, as the menu bar judges it; the trash opens nothing (its rows are not item targets).
  'item.openInBackground': (c, t) => c.view === 'library' && c.scope !== 'trash' && t.items.length >= 1,
  'tab.reopenClosed': (c) => c.closedOpenable === true,
  'tab.next': hasTab(2),
  'tab.previous': hasTab(2),
  'tab.goTo2': hasTab(2),
  'tab.goTo3': hasTab(3),
  'tab.goTo4': hasTab(4),
  'tab.goTo5': hasTab(5),
  'tab.goTo6': hasTab(6),
  'tab.goTo7': hasTab(7),
  'tab.goTo8': hasTab(8),
  'tab.last': hasTab(2),
  // The palette moves the shown reader tab; the strip's own keys move the one that has the focus.
  'tab.moveLeft': (c) => c.view === 'viewer' && (c.tabCount ?? 0) >= 2,
  'tab.moveRight': (c) => c.view === 'viewer' && (c.tabCount ?? 0) >= 2,
  'tab.closeOthers': (c) => (c.tabCount ?? 0) >= 2,
  // A trashed item has no row in the library to show.
  'tab.revealInLibrary': (_c, t) => t.items.length === 1 && t.items[0]!.trashed !== true,
  'item.relink': (_ctx, t) => t.items.length === 1 && t.items[0]!.storageMode === 'linked' && t.items[0]!.availability === 'missing',
  'item.showInFolder': (_ctx, t) => t.items.length === 1 && t.items[0]!.availability === 'available',
  'item.openExternally': (_ctx, t) => t.items.length === 1 && t.items[0]!.availability === 'available',
  'item.exportCopy': (_ctx, t) => t.items.length === 1 && t.items[0]!.availability === 'available',
  // The reader's panel carries the pencil too (its target is the open item); the palette gives the reader no target.
  'item.editInfo': (c, t) => t.items.length === 1 && (c.view === 'library' || c.pdfOpen === true),
  // Filing needs the selection only (any file state: the file is not touched); the library view, as the menu bar judges it.
  'collection.addItems': (c) => c.view === 'library',
  // Takes the selection out of the collection viewed and what is below it: nothing to take out of anywhere else.
  'collection.removeItems': (c) => c.view === 'library' && c.scope === 'collection',
  // ⌘⌫ (P-11): the library view's selection — live items, or the trash view's rows there (neededTargets).
  'item.trash': (c) => c.view === 'library',
  // 복원: the trash view's rows only.
  'item.restore': (c) => c.view === 'library' && c.scope === 'trash',
  // 휴지통 비우기…: while the trash has something.
  'trash.empty': (c) => c.trashCount > 0,
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
  // 중복 정리 (spec 11.1): rows of 중복 항목 (any file state: no file is touched), and two groups or more for 모두 정리.
  'duplicates.keepOne': (c) => c.view === 'library' && c.scope === 'duplicates',
  'duplicates.keepOneAll': (c) => c.view === 'library' && (c.duplicateGroups ?? 0) >= 2,
  'file.cancelImport': (c) => c.importRunning === true,
  // Something to back up — in the library or only in its trash — and no backup on the line already (one at a time; an
  // import running first only makes it wait, spec 3.1).
  'file.backup': (c) => (c.libraryCount > 0 || c.trashCount > 0) && c.backupRunning !== true,
  // One restore at a time (a second click would otherwise be refused unseen); other work running first only makes it wait.
  'file.restore': (c) => c.restoreRunning !== true,
  // The reader zooms with these keys (P-9), and only a PDF with pages has a zoom; the library sizes its text.
  'view.textBigger': (c) => (c.view === 'viewer' ? c.pdfOpen === true : c.textSize < 15),
  'view.textSmaller': (c) => (c.view === 'viewer' ? c.pdfOpen === true : c.textSize > 12),
  'view.textReset': (c) => (c.view === 'viewer' ? c.pdfOpen === true : c.textSize !== 13),
  // The reader's view commands act on the open PDF.
  'reader.zoomAuto': pdfOpen,
  'reader.zoomPageWidth': pdfOpen,
  'reader.zoomPageFit': pdfOpen,
  'reader.rotateCw': pdfOpen,
  'reader.rotateCcw': pdfOpen,
  'reader.goToPage': pdfOpen,
  'nav.historyBack': (c) => c.pdfOpen === true && c.historyBack === true,
  'nav.historyForward': (c) => c.pdfOpen === true && c.historyForward === true,
  'reader.pageColorAuto': pdfOpen,
  'reader.pageColorOriginal': pdfOpen,
  'reader.pageColorSepia': pdfOpen,
  'reader.pageColorDark': pdfOpen,
  'reader.scrollVertical': pdfOpen,
  'reader.scrollHorizontal': pdfOpen,
  'reader.scrollPage': pdfOpen,
  'reader.spreadNone': spreadAllowed,
  'reader.spreadOdd': spreadAllowed,
  'reader.spreadEven': spreadAllowed,
};

/**
 * The targets a command needs, by the first kind it lists — except that a command of the trash rows takes those in the trash
 * view (⌘⌫ is 영구 삭제… there, P-11) and its other kind elsewhere. Null: it needs none (app or view context).
 */
function neededTargets(spec: CommandSpec, ctx: CommandContextState, t: Targets): readonly CommandTargetInfo[] | null {
  const c = spec.contexts;
  if (c.includes('trash') && ctx.scope === 'trash') return t.trash;
  if (c.includes('item')) return t.items;
  if (c.includes('collection')) return t.collections;
  if (c.includes('tag')) return t.tags;
  if (c.includes('trash')) return t.trash;
  return null;
}

/**
 * The single availability predicate, for a spec: main (menu bar, context menus) and the renderer (palette, toolbar, keymap).
 * `surface` is the renderer's: with it, a `duringWork` command is stopped by a modal surface only; without it (main),
 * by `blocked` like every other command. A command that lists `item`, `collection` or `tag` needs a target of that kind.
 */
export function commandAvailable(spec: CommandSpec, ctx: CommandContextState, targets: readonly CommandTargetInfo[] = [], surface?: CommandSurface): boolean {
  if (MAIN_OWNED_COMMANDS.has(spec.id)) return true;
  // ⌘W closes a tab or the window whatever holds the window (the role it replaced was always on), except under a modal surface of
  // the renderer's own (a sheet's question, the palette), which owns the keys.
  if (spec.id === 'tab.close' && surface?.modal !== true) return true;
  if ((spec.duringWork && surface !== undefined) ? surface.modal : ctx.blocked) return false;
  const t = targetsByKind(targets);
  const needed = neededTargets(spec, ctx, t);
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
