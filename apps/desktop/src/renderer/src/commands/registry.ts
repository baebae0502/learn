import { COMMANDS, type CommandId } from '@learn/domain/commands';
import type { StorageMode } from '@learn/domain';

/** What the app can do right now; App.tsx rebuilds it every render. */
export interface CommandEnv {
  view: 'library' | 'viewer';
  /** An import is running or a modal dialog is open: every command is ignored. */
  blocked: boolean;
  importFiles(mode: StorageMode): void;
  back(): void;
  open(itemId: string): void;
  relink(itemId: string): void;
}

export interface CommandTarget {
  itemIds?: readonly string[];
}

type CommandHandler = (env: CommandEnv, itemIds: readonly string[]) => void;

/** Renderer side of the command registry: one handler per COMMANDS id (menus can only show handled commands). */
export const COMMAND_HANDLERS: Record<CommandId, CommandHandler> = {
  'file.importManaged': (env) => env.importFiles('managed'),
  'file.importLinked': (env) => env.importFiles('linked'),
  'nav.back': (env) => env.back(),
  'item.open': (env, [itemId]) => env.open(itemId!),
  'item.relink': (env, [itemId]) => env.relink(itemId!),
};

/**
 * Runs a command if it applies now and returns whether it ran. Menu items stay enabled until M3, so a
 * command outside its context (e.g. "라이브러리로 돌아가기" in the library) is ignored here.
 * Item commands (context menu) act on exactly one item in M2.
 */
export function runCommand(id: CommandId, env: CommandEnv, target: CommandTarget = {}): boolean {
  const spec = COMMANDS.find((c) => c.id === id);
  if (!spec || !Object.hasOwn(COMMAND_HANDLERS, id) || env.blocked) return false;
  const itemIds = target.itemIds ?? [];
  if (spec.contexts.includes('item')) {
    if (itemIds.length !== 1) return false;
  } else if (!spec.contexts.includes(env.view)) {
    return false;
  }
  COMMAND_HANDLERS[id](env, itemIds);
  return true;
}
