import type { ConfirmPurgeInput, PurgeVariant, PurgedRows, TrashView } from '@learn/domain';
import type { TrashRows } from '../commands/registry';
import { inChunks } from '../organize/membership';
import { t } from '../strings';

/** Everything the trash's actions touch outside themselves, so they run in a test without a window (trash/actions.ts wires it). */
export interface TrashDeps {
  /** library.trash for one part (5,000 ids at most; trashItems cuts a larger selection): how many items went (one deletion stamp per call). */
  trash(itemIds: string[]): Promise<number>;
  /** library.restore: how many items came back. */
  restoreItems(itemIds: string[]): Promise<number>;
  restoreCollection(collectionId: string): Promise<void>;
  purge(rows: TrashRows): Promise<PurgedRows>;
  /** The trash as it is now: 휴지통 비우기… from another view has no read of it yet. */
  readTrash(): Promise<TrashView>;
  /** The purge sheet (P-25): true when its destructive button was pressed. */
  confirmPurge(input: ConfirmPurgeInput): Promise<boolean>;
  /** A live item's title, for the toast that names one item. */
  titleOf(itemId: string): string | undefined;
  /** Takes the trashed items out of the cached list at once (spec 14: ⌘⌫ → the redrawn table ≤ 300 ms); the notice's read follows. */
  dropFromList(itemIds: readonly string[]): void;
  toast(title: string, testId: string): void;
  /** The toast's key, for closeToast. */
  undoToast(title: string, undo: () => Promise<void>): string;
  /** Closes a toast by its key (a key already gone is nothing). */
  closeToast(key: string): void;
  /** R-5b: an error toast that names the part already moved and offers 실행 취소 for it (showUndoableError). */
  failedWithUndo(e: unknown, title: string, undo: () => Promise<void>): void;
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
  /**
   * An 실행 취소 toast of another action that trashed these items (하나만 남기고 휴지통으로): a purge or an emptied trash
   * closes it once none of them can come back, as the ⌘⌫ toast's own. Returns a dispose that drops the entry (its toast's own 실행 취소).
   */
  trackUndo(toastKey: string, itemIds: readonly string[]): () => void;
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
  /**
   * The 실행 취소 toasts that stand for trashed items (critique C-1): key -> the ids not yet gone for good. A purge closes the
   * toast whose items are all gone, so no 실행 취소 is left for what cannot come back.
   */
  const undoable = new Map<string, Set<string>>();
  const closeFor = (purged: readonly string[] | 'all'): void => {
    const gone = purged === 'all' ? undefined : new Set(purged);
    for (const [key, ids] of undoable) {
      if (gone) for (const id of gone) ids.delete(id);
      if (!gone || ids.size === 0) {
        undoable.delete(key);
        deps.closeToast(key);
      }
    }
  };
  /** The title or name of the one trashed row chosen, for the sheet and the toast that name it; none for several, or when the trash cannot be read. */
  const nameOfOne = async ({ itemIds, collectionIds }: TrashRows): Promise<string | undefined> => {
    if (itemIds.length + collectionIds.length !== 1) return undefined;
    try {
      const view = await deps.readTrash();
      return itemIds.length === 1 ? view.items.find((i) => i.id === itemIds[0])?.title : view.collections.find((c) => c.id === collectionIds[0])?.name;
    } catch {
      return undefined;
    }
  };
  return {
    async trashItems(itemIds) {
      const ids = [...new Set(itemIds)];
      if (ids.length === 0) return;
      const one = ids.length === 1 ? deps.titleOf(ids[0]!) : undefined;
      let moved = 0;
      const sent: string[] = [];
      try {
        for (const part of inChunks(ids)) {
          moved += await deps.trash(part);
          sent.push(...part);
        }
      } catch (e) {
        // R-5b: the parts before the refused one are in the trash; say so and offer to put them back.
        if (moved > 0) {
          deps.dropFromList(sent);
          deps.failedWithUndo(e, t.trash.movedPart(moved), async () => void (await deps.restoreItems(sent)));
        } else deps.failed(e);
        return;
      }
      if (moved === 0) return;
      deps.dropFromList(ids);
      // An undo that restores nothing (the items are gone for good, or already back) ends quietly.
      const key = deps.undoToast(one !== undefined ? t.trash.movedOne(one) : t.trash.moved(moved), async () => {
        await deps.restoreItems(ids);
        undoable.delete(key);
      });
      undoable.set(key, new Set(ids));
    },

    trackUndo(toastKey, itemIds) {
      undoable.set(toastKey, new Set(itemIds));
      return () => void undoable.delete(toastKey);
    },

    async restore(rows, opts = {}) {
      const { itemIds, collectionIds } = rows;
      const one = opts.quiet ? undefined : await nameOfOne(rows);
      let items = 0;
      let collections = 0;
      try {
        if (itemIds.length > 0) items += await deps.restoreItems([...itemIds]);
        for (const id of collectionIds) {
          await deps.restoreCollection(id);
          collections += 1;
        }
      } catch (e) {
        deps.failed(e);
      }
      if (items + collections === 0 || opts.quiet) return;
      const title = one === undefined ? t.trash.restored(items, collections) : items === 1 ? t.trash.restoredOne(one) : t.trash.collectionRestored(one);
      deps.toast(title, 'restore-done');
    },

    async purge({ itemIds, collectionIds }) {
      const items = itemIds.length;
      const collections = collectionIds.length;
      if (items + collections === 0) return;
      const name = await nameOfOne({ itemIds, collectionIds });
      if (!(await ask({ variant: purgeVariant(items, collections), items, collections, ...(name !== undefined ? { name } : {}) }))) return;
      let done: PurgedRows;
      try {
        done = await deps.purge({ itemIds: [...itemIds], collectionIds: [...collectionIds] });
      } catch (e) {
        deps.failed(e);
        return;
      }
      closeFor(done.itemIds);
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
      // Exactly the rows the sheet counted (R-3), not whatever the trash holds by now.
      const counted: TrashRows = { itemIds: view.items.map((i) => i.id), collectionIds: view.collections.map((c) => c.id) };
      try {
        await deps.purge(counted);
      } catch (e) {
        deps.failed(e);
        return;
      }
      closeFor('all');
      deps.toast(t.trash.emptied, 'purge-done');
    },
  };
}
