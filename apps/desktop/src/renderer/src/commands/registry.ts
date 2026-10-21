import { isCommandAvailable, type CommandContextState, type CommandId, type CommandTargetInfo } from '@learn/domain/commands';
import type { StorageMode } from '@learn/domain';

/** What the main window can do now: its command context plus the handlers. Rebuilt every render; later tasks add handlers. */
export interface CommandEnv extends CommandContextState {
  /** Availability facts for item targets (from the library list). */
  targetsOf(itemIds: readonly string[]): CommandTargetInfo[];
  importFiles(mode: StorageMode): void;
  back(): void;
  open(itemId: string): void;
  relink(itemId: string): void;
  /** ⌃⌘S (Task 4). */
  toggleSidebar(): void;
  /** ⌘/ (Task 6). */
  showShortcuts(): void;
  /** ⌘K (Task 9): opens the palette, or selects its field when it is already open. */
  openPalette(): void;
  /** Finder에서 보기 / 기본 앱으로 열기 (Task 7). */
  showInFolder(itemId: string): void;
  openExternally(itemId: string): void;
}

export interface CommandTarget {
  itemIds?: readonly string[];
}

type Handler = (env: CommandEnv, itemIds: readonly string[]) => void;

/** Renderer side of the registry: exactly one handler per command id (menus can only show handled commands). */
export const COMMAND_HANDLERS: Record<CommandId, Handler> = {
  'file.importManaged': (env) => env.importFiles('managed'),
  'file.importLinked': (env) => env.importFiles('linked'),
  'nav.back': (env) => env.back(),
  'item.open': (env, [itemId]) => env.open(itemId!),
  'item.showInFolder': (env, [itemId]) => env.showInFolder(itemId!),
  'item.openExternally': (env, [itemId]) => env.openExternally(itemId!),
  'item.relink': (env, [itemId]) => env.relink(itemId!),
  'view.toggleSidebar': (env) => env.toggleSidebar(),
  'app.shortcuts': (env) => env.showShortcuts(),
  'app.palette': (env) => env.openPalette(),
};

/** Just the context fields (what main needs for the menu bar: availability, and the sidebar state for its labels). */
export function contextOf(env: CommandEnv): CommandContextState {
  return { view: env.view, blocked: env.blocked, ...(env.sidebar ? { sidebar: env.sidebar } : {}) };
}

export function isCommandEnabled(id: CommandId, env: CommandEnv, target: CommandTarget = {}): boolean {
  if (!Object.hasOwn(COMMAND_HANDLERS, id)) return false;
  const itemIds = target.itemIds ?? [];
  return isCommandAvailable(id, contextOf(env), env.targetsOf(itemIds));
}

/** Runs a command if it is available now; returns whether it ran. */
export function runCommand(id: CommandId, env: CommandEnv, target: CommandTarget = {}): boolean {
  if (!isCommandEnabled(id, env, target)) return false;
  COMMAND_HANDLERS[id](env, target.itemIds ?? []);
  return true;
}

/**
 * A command picked from a native context menu: main enabled it with fresh file state (the renderer's list may lag
 * one libraryChanged behind), so only the window-level block is checked here.
 */
export function runPicked(id: CommandId, env: CommandEnv, itemIds: readonly string[]): boolean {
  if (!Object.hasOwn(COMMAND_HANDLERS, id) || env.blocked) return false; // COMMAND_HANDLERS has exactly the registry ids
  COMMAND_HANDLERS[id](env, itemIds);
  return true;
}
