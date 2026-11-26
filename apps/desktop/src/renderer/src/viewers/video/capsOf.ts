import { commandById, keySpecKeys, type CommandId } from '@learn/domain';
import { currentPlatform } from '../../ui/platform';

/**
 * The keys of commands as a tooltip says them: "K · 스페이스", "J"; two commands side by side ("⇧, ⇧."). A Mac spells ⇧ before the
 * key, elsewhere it is Shift+.
 */
export function capsOf(...ids: CommandId[]): string {
  const platform = currentPlatform();
  return ids
    .flatMap((id) => [commandById(id).key, commandById(id).alsoKey])
    .flatMap((k) => (k ? [keySpecKeys(k, platform).join(platform === 'darwin' ? '' : '+')] : []))
    .join(platform === 'darwin' && ids.length > 1 ? ' ' : ' · ');
}
