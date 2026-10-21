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
  | 'app.shortcuts';
/** `app`: anywhere in the main window; `library` / `viewer`: the current view; `item`: needs item targets. */
export type CommandContext = 'app' | 'library' | 'viewer' | 'item';
/** `app` is the macOS application menu (Linux/Windows put those items at the end of 파일); `help` is 도움말. */
export type MenuName = 'app' | 'file' | 'edit' | 'view' | 'go' | 'window' | 'help';
export const CONTEXT_MENU_KINDS = ['item', 'collection', 'tag', 'column'] as const;
/** Native context menus (ADR-0005 §4): items now; collections, tags and table column headers from M4–M5. */
export type ContextMenuKind = (typeof CONTEXT_MENU_KINDS)[number];

/** Whether the sidebar is shown (layout B) — what the sidebar command's label depends on. */
export type SidebarState = 'shown' | 'hidden';

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
   */
  stateLabels?: { sidebar: Readonly<Record<SidebarState, string>> };
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
  { id: 'item.showInFolder', label: 'Finder에서 보기', labelOff: '폴더에서 보기', contexts: ['item'], contextMenu: { kinds: ['item'], group: 2, order: 1 } },
  // Not in the item context menu: design-spec 7.3 lists no such item ("여기 없는 메뉴는 그리지 않는다", C-1).
  // It is a notice button only: the unplayable video (10.7) and the PDF that cannot be opened (C-1 as amended).
  { id: 'item.openExternally', label: '기본 앱으로 열기', contexts: ['item'] },
  {
    id: 'view.toggleSidebar', label: '사이드바 보기/가리기', accelerator: 'Ctrl+Cmd+S', menu: { menu: 'view', group: 2, order: 1 }, contexts: ['app'],
    stateLabels: { sidebar: { shown: '사이드바 가리기', hidden: '사이드바 보기' } },
    keywords: ['사이드바', '패널', '가리기', '숨기기', '보기', 'sidebar'],
  },
  {
    id: 'app.shortcuts', label: '단축키 도움말', accelerator: 'CmdOrCtrl+/', menu: { menu: 'help', group: 1, order: 1 }, contexts: ['app'],
    keywords: ['단축키', '키보드', '도움말', 'shortcuts', 'keyboard'],
  },
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
export function commandLabel(c: CommandSpec, platform: string, state: Pick<CommandContextState, 'sidebar'> = {}): string {
  if (c.stateLabels && state.sidebar) return c.stateLabels.sidebar[state.sidebar];
  return platform !== 'darwin' && c.labelOff ? c.labelOff : c.label;
}

/** Commands main runs itself: always available, even before (or without) a renderer. */
export const MAIN_OWNED_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>([]);

/** What availability depends on. The main window's renderer owns it and reports it (ui:reportContext). */
export interface CommandContextState {
  view: 'library' | 'viewer';
  /** An import, a modal sheet or the fatal screen owns the window: nothing runs. */
  blocked: boolean;
  /** For state labels only (not availability): absent where the window has no sidebar (the fatal screen). */
  sidebar?: SidebarState;
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

type Rule = (ctx: CommandContextState, targets: readonly CommandTargetInfo[]) => boolean;
const RULES: Partial<Record<CommandId, Rule>> = {
  'item.open': (_ctx, t) => t.length === 1,
  'item.relink': (_ctx, t) => t.length === 1 && t[0]!.storageMode === 'linked' && t[0]!.availability === 'missing',
  'item.showInFolder': (_ctx, t) => t.length === 1 && t[0]!.availability === 'available',
  'item.openExternally': (_ctx, t) => t.length === 1 && t[0]!.availability === 'available',
};

/** The single availability predicate: main (menu bar, context menus) and the renderer (palette, toolbar, keymap). */
export function isCommandAvailable(id: CommandId, ctx: CommandContextState, targets: readonly CommandTargetInfo[] = []): boolean {
  const spec = COMMANDS.find((c) => c.id === id);
  if (!spec) return false;
  if (MAIN_OWNED_COMMANDS.has(id)) return true;
  if (ctx.blocked) return false;
  const inContext = spec.contexts.includes('item') ? targets.length > 0 : spec.contexts.includes('app') || spec.contexts.includes(ctx.view);
  return inContext && (RULES[id]?.(ctx, targets) ?? true);
}

/** Menu-bar commands available in `ctx` (item commands live in context menus). */
export function availableMenuCommands(ctx: CommandContextState): CommandId[] {
  return COMMANDS.filter((c) => c.menu !== undefined && !c.contexts.includes('item') && isCommandAvailable(c.id, ctx)).map((c) => c.id);
}
