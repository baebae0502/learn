import type { CommandArgs, LibraryScope } from '@learn/domain';
import { t } from '../strings';
import type { Removal, addItemsTo, removeFromScope, undoRemovals } from './membership';
import type { OrganizeModel } from './model';

export interface MembershipDeps {
  model(): OrganizeModel | undefined;
  /** The scope the user chose (not the one `resolveScope` shows while a collection is being undone back in). */
  scope(): LibraryScope;
  addItemsTo: typeof addItemsTo;
  removeFromScope: typeof removeFromScope;
  undoRemovals: typeof undoRemovals;
  /** The sidebar names a new top-level collection in place; `onCreated` comes only when a name was made (esc makes none). */
  startNew(opts: { onCreated(collectionId: string): void }): void;
  undoToast(title: string, undo: () => Promise<void>): void;
  failed(e: unknown): void;
}

export interface MembershipCommands {
  /** 컬렉션에 추가: the row's collection, or a new one (`addSelection`). */
  add(itemIds: readonly string[], args: CommandArgs): void;
  /** 이 컬렉션에서 빼기: out of the collection viewed and everything below it, with an undo. */
  remove(itemIds: readonly string[]): Promise<void>;
}

export function createMembershipCommands(deps: MembershipDeps): MembershipCommands {
  return {
    add(itemIds, args) {
      // The selection as it is when the row is picked: naming a new collection takes time and the table may move on.
      const ids = [...new Set(itemIds)];
      if (ids.length === 0) return;
      const file = (collectionId: string) => void deps.addItemsTo(collectionId, ids).catch(deps.failed);
      if (args.collectionId !== undefined) file(args.collectionId);
      else if (args.addSelection) deps.startNew({ onCreated: file });
    },

    async remove(itemIds) {
      const scope = deps.scope();
      const model = deps.model();
      const node = scope.kind === 'collection' ? model?.node(scope.id) : undefined;
      if (!model || !node || scope.kind !== 'collection') return;
      let removals: Removal[];
      try {
        removals = await deps.removeFromScope(model, scope.id, itemIds);
      } catch (e) {
        deps.failed(e);
        return;
      }
      if (removals.length === 0) return;
      const items = new Set(removals.flatMap((r) => r.itemIds)).size;
      deps.undoToast(t.organize.panel.removed(node.name, items), () => deps.undoRemovals(removals));
    },
  };
}
