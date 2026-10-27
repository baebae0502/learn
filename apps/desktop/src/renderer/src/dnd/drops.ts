import type { LibraryScope, OrganizeSnapshot, OrganizeTag } from '@learn/domain';
import type { Removal } from '../organize/membership';
import type { OrganizeModel } from '../organize/model';
import { withMoved } from '../sidebar/organizeCache';
import { t } from '../strings';
import type { PerfMark } from '../ui/perfMarks';
import { collectionOnCollection, tagOnRow } from './rules';

/** Everything a drop touches outside itself, so it runs in a test without a window. */
export interface DropDeps {
  model(): OrganizeModel | undefined;
  /** The view shown now (the chosen scope after resolveScope). */
  scope(): LibraryScope;
  selected(): ReadonlySet<string>;
  addItemsTo(collectionId: string, itemIds: readonly string[]): Promise<string[]>;
  removeFromScope(model: OrganizeModel, scopeCollectionId: string, itemIds: readonly string[], progress?: Removal[]): Promise<Removal[]>;
  undoRemovals(removals: readonly Removal[]): Promise<void>;
  undoAdds(collectionId: string, added: readonly string[]): Promise<void>;
  moveCollection(input: { collectionId: string; parentId: string | null }): Promise<{ parentId: string | null }>;
  /** Changes the organize snapshot in the cache; the notice main sends next brings the real one. */
  patch(update: (s: OrganizeSnapshot) => OrganizeSnapshot): void;
  /** Opens the closed collections above a collection, so its row is on screen. */
  reveal(collectionId: string): void;
  attachTag(itemIds: readonly string[], pick: { tag: OrganizeTag }): Promise<unknown>;
  undoToast(title: string, undo: () => Promise<void>): void;
  failed(e: unknown): void;
  mark(name: Extract<PerfMark, `dnd:${string}`>): void;
}

export interface DropActions {
  /**
   * Rows dropped on a collection row. An add is silent. A move — the move key, in a viewed collection — is two halves:
   * out of the view's collection and everything below it, then into the target, which may be one of those (the order
   * keeps it there). A refusal in either half puts the first back and is one error toast; success offers one undo.
   */
  itemsOn(targetId: string, itemIds: readonly string[], operation: string): Promise<void>;
  /** A collection dropped on a collection row, or (null) on the 컬렉션 heading. */
  collectionOn(collectionId: string, parentId: string | null): Promise<void>;
  /** A tag dropped on the table row `rowId`: on the selection when the row is in it, else on the row. */
  tagOn(tagId: string, rowId: string): Promise<void>;
}

export function createDropActions(deps: DropDeps): DropActions {
  // A put-back that is refused too leaves the first error to tell the user; the notice that follows shows the true state.
  const quietly = (run: () => Promise<void>) => run().catch(() => undefined);

  return {
    async itemsOn(targetId, itemIds, operation) {
      deps.mark('dnd:drop');
      const model = deps.model();
      const target = model?.node(targetId);
      if (!model || !target || itemIds.length === 0) return;
      const scope = deps.scope();
      try {
        if (operation !== 'move' || scope.kind !== 'collection') {
          await deps.addItemsTo(targetId, itemIds);
          deps.mark('dnd:filed');
          return;
        }
        const removals: Removal[] = [];
        try {
          await deps.removeFromScope(model, scope.id, itemIds, removals);
        } catch (e) {
          await quietly(() => deps.undoRemovals(removals));
          throw e;
        }
        let added: string[];
        try {
          added = await deps.addItemsTo(targetId, itemIds);
        } catch (e) {
          await quietly(() => deps.undoRemovals(removals));
          throw e;
        }
        deps.mark('dnd:filed');
        const moved = new Set([...removals.flatMap((r) => r.itemIds), ...added]);
        if (moved.size === 0) return;
        deps.undoToast(t.organize.dnd.moved(moved.size, target.name), async () => {
          // The target may be gone by now: the rows still go back to where they were, and the failure is told after.
          let failure: { error: unknown } | null = null;
          try {
            await deps.undoAdds(targetId, added);
          } catch (e) {
            failure = { error: e };
          }
          await deps.undoRemovals(removals);
          if (failure) deps.failed(failure.error);
        });
      } catch (e) {
        deps.failed(e);
      }
    },

    async collectionOn(collectionId, parentId) {
      if (collectionOnCollection({ dragged: collectionId, target: parentId, model: deps.model() }) === 'cancel') return;
      try {
        const moved = await deps.moveCollection({ collectionId, parentId });
        deps.patch((s) => withMoved(s, collectionId, moved.parentId));
        deps.reveal(collectionId);
      } catch (e) {
        deps.failed(e);
      }
    },

    async tagOn(tagId, rowId) {
      deps.mark('dnd:drop');
      const model = deps.model();
      const tag = model?.tags.find((x) => x.id === tagId);
      const ids = tagOnRow({ tagId, rowId, selected: deps.selected(), model });
      if (!tag || !ids) return;
      try {
        await deps.attachTag(ids, { tag });
        deps.mark('dnd:filed');
      } catch (e) {
        deps.failed(e);
      }
    },
  };
}
