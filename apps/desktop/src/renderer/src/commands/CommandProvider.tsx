import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CommandId } from '@learn/domain';
import { isCommandEnabled, runCommand, type CommandEnv, type CommandTarget } from './registry';

interface Commands {
  env: CommandEnv;
  run(id: CommandId, target?: CommandTarget): boolean;
  isEnabled(id: CommandId, target?: CommandTarget): boolean;
}

const CommandContext = createContext<Commands | null>(null);

/** Every in-window control runs registry commands through this (same path as the menu bar and the palette). */
export function CommandProvider({ env, children }: { env: CommandEnv; children: ReactNode }) {
  const value = useMemo<Commands>(
    () => ({ env, run: (id, target) => runCommand(id, env, target), isEnabled: (id, target) => isCommandEnabled(id, env, target) }),
    [env],
  );
  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

export function useCommands(): Commands {
  const value = useContext(CommandContext);
  if (!value) throw new Error('useCommands() outside <CommandProvider>');
  return value;
}
