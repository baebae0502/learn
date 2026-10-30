import type { QueryClient } from '@tanstack/react-query';
import { itemTarget, type CommandTargetInfo, type LibraryItem, type OrganizeSnapshot } from '@learn/domain';
import { keys } from '../data/queries';
import { freshTargets } from '../data/targets';
import type { CommandTarget } from './registry';

/**
 * The facts a command is judged on, by kind: items from the freshest read (data/targets.ts), collections by id,
 * tags with whether they have a colour (from the organize snapshot; a tag it does not know is no target).
 */
export function commandTargets(client: QueryClient, list: readonly LibraryItem[], target: CommandTarget): CommandTargetInfo[] {
  const tags = (target.tagIds ?? []).length > 0 ? client.getQueryData<OrganizeSnapshot>(keys.organize)?.tags : undefined;
  return [
    ...freshTargets(client, list, target.itemIds ?? []).map((i) => itemTarget(i)),
    ...(target.collectionIds ?? []).map((id): CommandTargetInfo => ({ kind: 'collection', id })),
    ...(target.tagIds ?? []).flatMap((id): CommandTargetInfo[] => {
      const tag = tags?.find((t) => t.id === id);
      return tag ? [{ kind: 'tag', id, hasColor: tag.color !== null }] : [];
    }),
  ];
}
