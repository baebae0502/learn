import { useLearnEvent } from '../events';
import { closePalette } from '../palette/Palette';
import { useShell } from '../state/shell-store';
import { runCommand, type CommandEnv } from './registry';

/**
 * Application-menu clicks and accelerators arrive as menuCommand; the registry decides whether they apply now. A menu
 * command while the palette is open closes it first, then runs from where the focus was (ADR-0005 §5); ⌘K itself
 * keeps it open and selects its field.
 */
export function useMenuCommands(env: CommandEnv): void {
  useLearnEvent('menuCommand', ({ commandId }) => {
    if (commandId !== 'app.palette' && useShell.getState().paletteOpen) closePalette(() => runCommand(commandId, env));
    else runCommand(commandId, env);
  });
}
