import { Channels, emptyInput, keepOneInput, keepOneUndoInput, purgeInput, toLearnError, type KeepOneResult, type PurgedRows } from '@learn/domain';
import type { PurgeResult } from '@learn/db';
import { removePurgedFiles } from '@learn/library';
import { broadcast } from '../events';
import type { LibraryContext } from '../library-context';
import { timeLast, timeLastAsync } from '../perf';
import type { Handle, IpcDeps } from './register';

/** The file step of each purge, in the order they committed (tests wait on it; the app never does). */
let filesSettled: Promise<void> = Promise.resolve();
export const purgeFilesSettled = (): Promise<void> => filesSettled;

/**
 * After the commit (ADR-0006): the files of the assets no item uses any more, behind the purges before it. The answer
 * does not wait for them — the trash view has already changed. What cannot be removed stays for the library check;
 * the log has the count only. A closed database (the app quitting) keeps every copy: nothing can be asked again.
 */
function removeFilesAfter(ctx: LibraryContext, assets: PurgeResult['assets']): void {
  if (assets.length === 0) return;
  const inUse = (relativePath: string): boolean => !ctx.db.open || ctx.repo.managedPathInUse(relativePath);
  filesSettled = filesSettled
    .then(() => timeLastAsync('purgeFiles', () => removePurgedFiles(ctx.layout, assets, { inUse })))
    .then(({ failed }) => {
      if (failed > 0) console.warn(`[library] purge: ${failed} file(s) left for the library check`);
    })
    .catch((e: unknown) => console.warn(`[library] purge: removing its files failed: ${toLearnError(e).code}`));
}

/** Rows first, files after; one notice for what really went. */
function announcePurge(ctx: LibraryContext, result: PurgeResult): PurgedRows {
  const { itemIds, collectionIds } = result;
  if (itemIds.length > 0) broadcast('libraryChanged', { reason: 'purge', itemIds });
  else if (collectionIds.length > 0) broadcast('libraryChanged', { reason: 'purge' });
  removeFilesAfter(ctx, result.assets);
  return { itemIds, collectionIds };
}

/** The trashed items and the kept ones changed (memberships, tags): one trash notice for them all. */
function announceKeepOne(result: KeepOneResult): KeepOneResult {
  if (result.trashed.length > 0) broadcast('libraryChanged', { reason: 'trash', itemIds: [...result.trashed, ...result.kept] });
  return result;
}

/** The trash view's data, 영구 삭제 and 휴지통 비우기 (spec 4.3–4.5), and the duplicate clean-up (spec 5). */
export function registerTrashIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.library.trashView, emptyInput, () => deps.getContext().repo.trashView());

  handle(Channels.library.purge, purgeInput, ({ itemIds, collectionIds }) => {
    const ctx = deps.getContext();
    // spec 14 budgets the transaction alone; the files go after the answer and are timed on their own.
    return announcePurge(ctx, timeLast('purge', () => ctx.repo.purge({ itemIds, collectionIds })));
  });

  handle(Channels.library.emptyTrash, emptyInput, () => {
    const ctx = deps.getContext();
    return announcePurge(ctx, timeLast('emptyTrash', () => ctx.repo.emptyTrash()));
  });

  handle(Channels.library.keepOneOfDuplicates, keepOneInput, ({ itemIds }) => announceKeepOne(deps.getContext().repo.keepOneOfDuplicates(itemIds)));

  handle(Channels.library.keepOneOfAllDuplicates, emptyInput, () => announceKeepOne(deps.getContext().repo.keepOneOfAllDuplicates()));

  handle(Channels.library.undoKeepOne, keepOneUndoInput, (undo) => {
    const restored = deps.getContext().repo.undoKeepOne(undo);
    if (restored.length > 0) {
      const keptSet = new Set(undo.kept);
      const kept = [...undo.memberships, ...undo.tags].map(([, itemId]) => itemId).filter((id) => keptSet.has(id));
      broadcast('libraryChanged', { reason: 'restore', itemIds: [...new Set([...restored, ...kept])] });
    }
    return restored.length;
  });
}
