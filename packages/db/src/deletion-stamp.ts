import { nowIso } from '@learn/domain';
import type { Db } from './connection';

/**
 * The `deleted_at` stamp for the next move to the trash: later than every stamp items and collections hold. Restore finds
 * a batch by its stamp, so two moves in one millisecond must not share one — a child deleted on its own would come back
 * with its parent (m-4). Call it inside the transaction that writes the stamp.
 */
export function nextDeletionStamp(db: Db): string {
  const { last } = db
    .prepare('SELECT MAX(s) AS last FROM (SELECT MAX(deleted_at) AS s FROM items UNION ALL SELECT MAX(deleted_at) AS s FROM collections)')
    .get() as { last: string | null };
  const now = nowIso();
  const latest = last === null ? Number.NaN : Date.parse(last);
  if (Number.isNaN(latest) || Date.parse(now) > latest) return now;
  return new Date(latest + 1).toISOString();
}
