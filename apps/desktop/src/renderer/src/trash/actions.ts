import type { LibraryItem } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys, putItems } from '../data/queries';
import { queryClient } from '../data/query-client';
import { inChunks } from '../organize/membership';
import { askInSheet } from '../ui/sheetAsk';
import { closeToast, showActionFailed, showToast, showUndoableError, showUndoToast } from '../ui/toasts';
import { createTrashActions } from './trashActions';

/** library.restore takes 5,000 ids a call (itemIdsInput): a larger selection goes in parts (trashItems cuts its own). */
async function inParts(ids: readonly string[], call: (part: string[]) => Promise<number>): Promise<number> {
  let n = 0;
  for (const part of inChunks(ids)) n += await call(part);
  return n;
}

/** The window's trash actions: the registry env, the sidebar's drop target and the reader's notice share them. */
export const trashActions = createTrashActions({
  trash: (itemIds) => unwrap(api().library.trash({ itemIds })),
  restoreItems: (itemIds) => inParts(itemIds, (part) => unwrap(api().library.restore({ itemIds: part }))),
  restoreCollection: async (collectionId) => void (await unwrap(api().collections.restore({ collectionId }))),
  purge: (rows) => unwrap(api().library.purge(rows)),
  readTrash: () => queryClient.fetchQuery({ queryKey: keys.trash, queryFn: () => unwrap(api().library.trashView()), staleTime: 0 }),
  confirmPurge: (input) => askInSheet(() => unwrap(api().ui.confirmPurge(input))),
  titleOf: (itemId) => queryClient.getQueryData<LibraryItem[]>(keys.items)?.find((i) => i.id === itemId)?.title,
  dropFromList: (itemIds) => {
    const prev = queryClient.getQueryData<LibraryItem[]>(keys.items);
    if (!prev) return;
    const gone = new Set(itemIds);
    putItems(queryClient, prev, prev.filter((i) => !gone.has(i.id)));
  },
  toast: (title, testId) => void showToast({ kind: 'success', title, testId }),
  undoToast: (title, undo) => showUndoToast(title, undo, { testId: 'trash-undo' }),
  closeToast,
  failedWithUndo: showUndoableError,
  failed: showActionFailed,
});
