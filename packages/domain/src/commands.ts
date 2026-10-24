import type { KeySpec } from './accelerator';
import type { Availability, StorageMode } from './library';

/**
 * Single command registry (ADR-0005): the menu bar, ⌘K palette, native context menus, toolbar tooltips and the
 * shortcut sheet all render from it, and one predicate (isCommandAvailable) decides what can run.
 * No zod: the sandboxed preload imports this file (type imports only).
 */
export type CommandId =
  | 'file.importManaged'
  | 'file.importLinked'
  | 'nav.back'
  | 'item.open'
  | 'item.showInFolder'
  | 'item.openExternally'
  | 'item.relink'
  | 'view.toggleSidebar'
  | 'app.shortcuts'
  | 'app.palette'
  | 'app.settings'
  | 'view.textBigger'
  | 'view.textSmaller'
  | 'view.textReset'
  | 'view.nextPane'
  | 'view.previousPane';
/** `app`: anywhere in the main window; `library` / `viewer`: the current view; `item`: needs item targets. */
export type CommandContext = 'app' | 'library' | 'viewer' | 'item';
/** `app` is the macOS application menu (Linux/Windows put those items at the end of 파일); `help` is 도움말. */
export type MenuName = 'app' | 'file' | 'edit' | 'view' | 'go' | 'window' | 'help';
export const CONTEXT_MENU_KINDS = ['item', 'collection', 'tag', 'column'] as const;
/** Native context menus (ADR-0005 §4): items now; collections, tags and table column headers from M4–M5. */
export type ContextMenuKind = (typeof CONTEXT_MENU_KINDS)[number];

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
  /** Electron accelerator, owned by the native menu. */
  accelerator?: string;
  /** Single-key shortcut, matched by physical key in the renderer keymap. */
  key?: KeySpec;
  menu?: { menu: MenuName; group: number; order: number };
  /** Native context menus listing this command; separators between groups. */
  contextMenu?: { kinds: readonly ContextMenuKind[]; group: number; order: number; onlyWhenAvailable?: boolean };
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

export const COMMANDS: readonly CommandSpec[] = [
  {
    id: 'file.importManaged', label: '파일 가져오기…', accelerator: 'CmdOrCtrl+O', menu: { menu: 'file', group: 1, order: 1 }, contexts: ['library'],
    keywords: ['가져오기', '추가', '사본', 'PDF', '동영상', 'import', 'add'],
  },
  {
    id: 'file.importLinked', label: '외부 파일 연결…', accelerator: 'Alt+CmdOrCtrl+O', menu: { menu: 'file', group: 1, order: 2 }, contexts: ['library'],
    keywords: ['연결', '외부', '링크', 'link'],
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
  {
    id: 'view.toggleSidebar', label: '사이드바 보기/가리기', accelerator: 'Ctrl+Cmd+S', menu: { menu: 'view', group: 2, order: 1 }, contexts: ['app'],
    stateLabels: { sidebar: { shown: '사이드바 가리기', hidden: '사이드바 보기' } },
    keywords: ['사이드바', '패널', '가리기', '숨기기', '보기', 'sidebar'],
  },
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

export function commandById(id: CommandId): CommandSpec {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown command: ${id}`);
  return c;
}

export const inPalette = (c: CommandSpec): boolean => c.palette ?? !c.contexts.includes('item');
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
}

/** Same context, field by field (every field is a primitive): main skips a report that changes nothing. */
export function sameCommandContext(a: CommandContextState, b: CommandContextState): boolean {
  const ka = Object.keys(a) as Array<keyof CommandContextState>;
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
}

/** A command target, as far as availability goes (fresh from disk in main's context menus). */
export interface CommandTargetInfo {
  storageMode: StorageMode;
  availability: Availability;
}

/**
 * What only the renderer knows, beside the reported context (never reported, so main's `blocked` stays as it is).
 * `modal`: a modal surface owns the keyboard — a sheet, the ⌘K palette, the drop overlay. `blocked` without it is work
 * in progress (an import), which stops every command but focus movement (`duringWork`).
 */
export interface CommandSurface {
  modal: boolean;
}

const AVAILABLE: CommandTargetInfo = Object.freeze({ storageMode: 'managed', availability: 'available' });
const RELINKABLE: CommandTargetInfo = Object.freeze({ storageMode: 'linked', availability: 'missing' });
const MISSING: CommandTargetInfo = Object.freeze({ storageMode: 'managed', availability: 'missing' });

/**
 * Synthetic targets for the menu bar: `selectionAvailable` available, then `selectionRelinkable` linked+missing, the
 * rest managed+missing. Main has only the reported counts; no rule reads the storage mode of an available target.
 * Counts that do not add up are clamped to `selectionCount`.
 */
export function selectionTargets(ctx: CommandContextState): CommandTargetInfo[] {
  const available = Math.min(ctx.selectionAvailable, ctx.selectionCount);
  const relinkable = Math.min(ctx.selectionRelinkable, ctx.selectionCount - available);
  return Array.from({ length: ctx.selectionCount }, (_, i) => (i < available ? AVAILABLE : i < available + relinkable ? RELINKABLE : MISSING));
}

type Rule = (ctx: CommandContextState, targets: readonly CommandTargetInfo[]) => boolean;
const RULES: Partial<Record<CommandId, Rule>> = {
  // Any availability: for a missing file the reader shows its 원본 없음 notice, which is where 다시 연결… lives.
  'item.open': (_ctx, t) => t.length === 1,
  'item.relink': (_ctx, t) => t.length === 1 && t[0]!.storageMode === 'linked' && t[0]!.availability === 'missing',
  'item.showInFolder': (_ctx, t) => t.length === 1 && t[0]!.availability === 'available',
  'item.openExternally': (_ctx, t) => t.length === 1 && t[0]!.availability === 'available',
  'view.textBigger': (c) => c.textSize < 15,
  'view.textSmaller': (c) => c.textSize > 12,
  'view.textReset': (c) => c.textSize !== 13,
};

/**
 * The single availability predicate: main (menu bar, context menus) and the renderer (palette, toolbar, keymap).
 * `surface` is the renderer's: with it, a `duringWork` command is stopped by a modal surface only; without it (main),
 * by `blocked` like every other command.
 */
export function isCommandAvailable(id: CommandId, ctx: CommandContextState, targets: readonly CommandTargetInfo[] = [], surface?: CommandSurface): boolean {
  const spec = COMMANDS.find((c) => c.id === id);
  if (!spec) return false;
  if (MAIN_OWNED_COMMANDS.has(id)) return true;
  if ((spec.duringWork && surface !== undefined) ? surface.modal : ctx.blocked) return false;
  const inContext = spec.contexts.includes('item') ? targets.length > 0 : spec.contexts.includes('app') || spec.contexts.includes(ctx.view);
  return inContext && (RULES[id]?.(ctx, targets) ?? true);
}

/**
 * Menu-bar commands available in `ctx`. An item command with a menu placement is judged on the selection's synthetic
 * targets (selectionTargets), in the library view only: the renderer runs it on the selected items. `commands` is the
 * registry; tests pass variants with other placements (availability is still the registry's, by id).
 */
export function availableMenuCommands(ctx: CommandContextState, commands: readonly CommandSpec[] = COMMANDS): CommandId[] {
  // Spec 6: the menu bar's item commands act on the library table's selection, so the reader has none.
  const targets = ctx.view === 'library' ? selectionTargets(ctx) : [];
  return commands.filter((c) => c.menu !== undefined && isCommandAvailable(c.id, ctx, targets)).map((c) => c.id);
}
