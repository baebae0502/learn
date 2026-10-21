import { useLearnEvent } from '../events';
import { runCommand, type CommandEnv } from './registry';

/** Application-menu clicks and accelerators arrive as menuCommand; the registry decides whether they apply now. */
export function useMenuCommands(env: CommandEnv): void {
  useLearnEvent('menuCommand', ({ commandId }) => {
    runCommand(commandId, env);
  });
}
