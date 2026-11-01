import type { ConfirmPurgeInput, PurgeVariant, PurgedRows, TrashView } from '@learn/domain';
import type { TrashRows } from '../commands/registry';
import { t } from '../strings';

/** Everything the trash's actions touch outside themselves, so they run in a test without a window (trash/actions.ts wires it). */
export interface TrashDeps {
  /** library.trash: how many items went (one deletion stamp per call). */
  trash(itemIds: string[]): Promise<number>;
  /** library.restore: how many items came back. */
  restoreItems(itemIds: string[]): Promise<number>;
  restoreCollection(collectionId: string): Promise<void>;
  purge(rows: TrashRows): Promise<PurgedRows>;
  emptyTrash(): Promise<PurgedRows>;
  /** The trash as it is now: 휴지통 비우기… from another view has no read of it yet. */
  readTrash(): Promise<TrashView>;
  /** The purge sheet (P-25): true when its destructive button was pressed. */
  confirmPurge(input: ConfirmPurgeInput): Promise<boolean>;
  /** A live item's title, for the toast that names one item. */
  titleOf(itemId: string): string | undefined;
  /** Takes the trashed items out of the cached list at once (spec 14: ⌘⌫ → the redrawn table ≤ 300 ms); the notice's read follows. */
  dropFromList(itemIds: readonly string[]): void;
  toast(title: string, testId: string): void;
  undoToast(title: string, undo: () => Promise<void>): void;
  failed(e: unknown): void;
}

export interface TrashActions {
  /** 휴지통으로 이동 (spec 4.1). */
  trashItems(itemIds: readonly string[]): Promise<void>;
  /** 복원 (spec 4.4); `quiet` from the reader, which reopens the item instead of a toast. */
  restore(rows: TrashRows, opts?: { quiet?: boolean }): Promise<void>;
  /** 영구 삭제… (spec 4.5). */
  purge(rows: TrashRows): Promise<void>;
  /** 휴지통 비우기… (spec 4.5). */
  emptyTrash(): Promise<void>;
}

/** What a purge sheet asks about. */
export const purgeVariant = (items: number, collections: number): PurgeVariant => (items > 0 && collections > 0 ? 'mixed' : collections > 0 ? 'collections' : 'items');

export function createTrashActions(deps: TrashDeps): TrashActions {
  /** The sheet's answer; a sheet that could not open is told and is a no. */
  const ask = async (input: ConfirmPurgeInput): Promise<boolean> => {
    try {
      return await deps.confirmPurge(input);
    } catch (e) {
      deps.failed(e);
      return false;
    }
  };
  return {
    async trashItems(itemIds) {
      const ids = [...new Set(itemIds)];
      if (ids.length === 0) return;
      const one = ids.length === 1 ? deps.titleOf(ids[0]!) : undefined;
      let moved: number;
      try {
        moved = await deps.trash(ids);
      } catch (e) {
        deps.failed(e);
        return;
      }
      if (moved === 0) return;
      deps.dropFromList(ids);
      deps.undoToast(one !== undefined ? t.trash.movedOne(one) : t.trash.moved(moved), async () => {
        await deps.restoreItems(ids);
      });
    },

    async restore({ itemIds, collectionIds }, opts = {}) {
      let restored = 0;
      try {
        if (itemIds.length > 0) restored += await deps.restoreItems([...itemIds]);
        for (const id of collectionIds) {
          await deps.restoreCollection(id);
          restored += 1;
        }
      } catch (e) {
        deps.failed(e);
      }
      if (restored > 0 && !opts.quiet) deps.toast(t.trash.restored(restored), 'restore-done');
    },

    async purge({ itemIds, collectionIds }) {
      const items = itemIds.length;
      const collections = collectionIds.length;
      if (items + collections === 0) return;
      if (!(await ask({ variant: purgeVariant(items, collections), items, collections }))) return;
      let done: PurgedRows;
      try {
        done = await deps.purge({ itemIds: [...itemIds], collectionIds: [...collectionIds] });
      } catch (e) {
        deps.failed(e);
        return;
      }
      if (done.itemIds.length + done.collectionIds.length > 0) deps.toast(t.trash.purged(done.itemIds.length, done.collectionIds.length), 'purge-done');
    },

    async emptyTrash() {
      let view: TrashView;
      try {
        view = await deps.readTrash();
      } catch (e) {
        deps.failed(e);
        return;
      }
      if (view.items.length + view.collections.length === 0) return;
      if (!(await ask({ variant: 'empty', items: view.items.length, collections: view.collections.length }))) return;
      try {
        await deps.emptyTrash();
      } catch (e) {
        deps.failed(e);
        return;
      }
      deps.toast(t.trash.emptied, 'purge-done');
    },
  };
}
