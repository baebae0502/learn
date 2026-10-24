import { COMMANDS, isCommandAvailable, type CommandContextState, type CommandId, type CommandTargetInfo } from '@learn/domain/commands';
import type { StorageMode } from '@learn/domain';
import type { TextSize, TextSizeUpdate } from '../settings/textSize';

/** What the main window can do now: its command context plus the handlers. Rebuilt every render; later tasks add handlers. */
export interface CommandEnv extends CommandContextState {
  /** Availability facts for item targets (from the library list). */
  targetsOf(itemIds: readonly string[]): CommandTargetInfo[];
  /**
   * The table selection in table order: the targets of an item command run from the menu bar. Read when the
   * command runs, so a closing palette does not run it on an older selection.
   */
  selection(): readonly string[];
  importFiles(mode: StorageMode): void;
  back(): void;
  open(itemId: string): void;
  relink(itemId: string): void;
  /** ⌃⌘S (Task 4). */
  toggleSidebar(): void;
  /** ⌥⌘I: the item panel, by the sidebar's rules (shell/layout.ts toggledInspector). */
  toggleInspector(): void;
  /** ⌘/ (Task 6). */
  showShortcuts(): void;
  /** ⌘K (Task 9): opens the palette, or selects its field when it is already open. */
  openPalette(): void;
  /** Finder에서 보기 / 기본 앱으로 열기 (Task 7). */
  showInFolder(itemId: string): void;
  openExternally(itemId: string): void;
  /** ⌘, (Task 10; main-owned: main opens the window, also from the palette). */
  openSettings(): void;
  /** ⌘+ / ⌘− / ⌘0 (Task 10): the UI text size pref, as a step from the newest size (settings/textSize.ts). */
  setTextSize(update: TextSizeUpdate): void;
  /** F6 / ⇧F6 (Task 12): the next / previous pane (shell/panes.ts). */
  focusPane(direction: 1 | -1): void;
  /** ⌘F: the quick search field takes the focus with its text selected (library/LibrarySearch.tsx). */
  focusSearch(): void;
  /**
   * A modal surface owns the keyboard: a sheet, the palette, the drop overlay (MainWindow derives it once). Not
   * reported to main; it tells an import (blocked alone) from a modal surface for `duringWork` commands.
   */
  modal: boolean;
  /**
   * A sheet was asked for and is not on screen yet (T13M-n4). Commands are judged as in the blocked, modal window it
   * is about to be, and main's menu bar is told so (reportedContext), but nothing is drawn disabled: the window does
   * not grey before the sheet appears.
   */
  held?: boolean;
}

const clampTextSize = (n: number): TextSize => Math.min(15, Math.max(12, n)) as TextSize;

export interface CommandTarget {
  itemIds?: readonly string[];
}

type Handler = (env: CommandEnv, itemIds: readonly string[]) => void;

/** Renderer side of the registry: exactly one handler per command id (menus can only show handled commands). */
export const COMMAND_HANDLERS: Record<CommandId, Handler> = {
  'file.importManaged': (env) => env.importFiles('managed'),
  'file.importLinked': (env) => env.importFiles('linked'),
  'library.find': (env) => env.focusSearch(),
  'nav.back': (env) => env.back(),
  'item.open': (env, [itemId]) => env.open(itemId!),
  'item.showInFolder': (env, [itemId]) => env.showInFolder(itemId!),
  'item.openExternally': (env, [itemId]) => env.openExternally(itemId!),
  'item.relink': (env, [itemId]) => env.relink(itemId!),
  'view.toggleSidebar': (env) => env.toggleSidebar(),
  'view.toggleInspector': (env) => env.toggleInspector(),
  'app.shortcuts': (env) => env.showShortcuts(),
  'app.palette': (env) => env.openPalette(),
  'app.settings': (env) => env.openSettings(),
  'view.textBigger': (env) => env.setTextSize((size) => clampTextSize(size + 1)),
  'view.textSmaller': (env) => env.setTextSize((size) => clampTextSize(size - 1)),
  'view.textReset': (env) => env.setTextSize(() => 13),
  'view.nextPane': (env) => env.focusPane(1),
  'view.previousPane': (env) => env.focusPane(-1),
};

/** Just the context fields (what main needs for the menu bar: availability and counts, and the pane states for its labels). */
export function contextOf(env: CommandEnv): CommandContextState {
  return {
    view: env.view,
    blocked: env.blocked,
    textSize: env.textSize,
    libraryCount: env.libraryCount,
    selectionCount: env.selectionCount,
    selectionAvailable: env.selectionAvailable,
    selectionRelinkable: env.selectionRelinkable,
    ...(env.sidebar ? { sidebar: env.sidebar } : {}),
    ...(env.inspector ? { inspector: env.inspector } : {}),
  };
}

/**
 * The targets of a command from the menu bar (its accelerator or a click): an item command acts on the table's
 * selection, which only the library view shows (spec 6: off in the reader, as main's availableMenuCommands judges it).
 */
export function menuTarget(id: CommandId, env: CommandEnv): CommandTarget {
  if (!COMMANDS.find((c) => c.id === id)?.contexts.includes('item')) return {};
  return { itemIds: env.view === 'library' ? env.selection() : [] };
}

/** The window a command is judged in: a held one counts as the blocked, modal window it is about to be. */
const judged = (env: CommandEnv): CommandEnv => (env.held ? { ...env, blocked: true, modal: true } : env);

/** What main is told (ui.reportContext): a held window as blocked, so the menu bar refuses what the sheet will. */
export const reportedContext = (env: CommandEnv): CommandContextState => contextOf(judged(env));

export function isCommandEnabled(id: CommandId, env: CommandEnv, target: CommandTarget = {}): boolean {
  if (!Object.hasOwn(COMMAND_HANDLERS, id)) return false;
  const itemIds = target.itemIds ?? [];
  return isCommandAvailable(id, contextOf(env), env.targetsOf(itemIds), { modal: env.modal });
}

/** Runs a command if it is available now; returns whether it ran. */
export function runCommand(id: CommandId, env: CommandEnv, target: CommandTarget = {}): boolean {
  if (!isCommandEnabled(id, judged(env), target)) return false;
  COMMAND_HANDLERS[id](env, target.itemIds ?? []);
  return true;
}

/**
 * A command picked from a native context menu: main enabled it with fresh file state (the renderer's list may lag
 * one libraryChanged behind), so only the window-level block is checked here.
 */
export function runPicked(id: CommandId, env: CommandEnv, itemIds: readonly string[]): boolean {
  if (!Object.hasOwn(COMMAND_HANDLERS, id) || judged(env).blocked) return false; // COMMAND_HANDLERS has exactly the registry ids
  COMMAND_HANDLERS[id](env, itemIds);
  return true;
}
