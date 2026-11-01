import type { LearnEventMap } from '@learn/domain';
import { ApiError } from '../api';

/** The reader and the trash (spec 4.6): `yes` the notice shows; `back` restored, the notice stays until the item reads again. */
export type TrashedState = 'no' | 'yes' | 'back';

/** The state after a library notice: only one about this item counts — trashed, restored, or purged (then the not-found notice). */
export function trashedAfter(state: TrashedState, change: Pick<LearnEventMap['libraryChanged'], 'reason' | 'itemIds'>, itemId: string): TrashedState {
  if (!change.itemIds?.includes(itemId)) return state;
  if (change.reason === 'trash') return 'yes';
  if (change.reason === 'restore') return state === 'no' ? 'no' : 'back';
  if (change.reason === 'purge') return 'no';
  return state;
}

/** The reader gives way to its open-failed notice only when the item could not be read at all, or is gone (NOT_FOUND). */
export function readerLost(read: { isError: boolean; data: unknown; error: unknown }): boolean {
  if (!read.isError) return false;
  return read.data === undefined || (read.error instanceof ApiError && read.error.code === 'NOT_FOUND');
}
