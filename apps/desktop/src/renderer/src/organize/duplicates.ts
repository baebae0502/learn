import type { LibraryItem } from '@learn/domain';
import type { OrganizeModel } from './model';

/** What the table draws in 중복 항목 (M6 spec 5): the rows that stay (남김), and the rows that start a group after another (the line above). */
export interface DuplicateMarks {
  kept: ReadonlySet<string>;
  starts: ReadonlySet<string>;
}

/**
 * The item that stays when its group is cleaned up: the earliest import, then the smaller id — the order the database
 * keeps it by (created_at, then id), so 남김 marks the item that really stays.
 */
export function keptOf(group: readonly Pick<LibraryItem, 'id' | 'createdAt'>[]): string | undefined {
  let best: Pick<LibraryItem, 'id' | 'createdAt'> | undefined;
  for (const i of group) if (best === undefined || i.createdAt < best.createdAt || (i.createdAt === best.createdAt && i.id < best.id)) best = i;
  return best?.id;
}

/**
 * The rows with each duplicate group's rows together, whatever the sort: a group comes where its first row came, its
 * rows in the order given; a row of no group keeps its place. The same array when nothing moves (memos downstream).
 */
export function groupRows<T extends { id: string }>(rows: readonly T[], groupOf: (id: string) => number | undefined): readonly T[] {
  const members = new Map<number, T[]>();
  const order: Array<T | number> = [];
  for (const row of rows) {
    const g = groupOf(row.id);
    if (g === undefined) {
      order.push(row);
      continue;
    }
    const list = members.get(g);
    if (list) list.push(row);
    else {
      members.set(g, [row]);
      order.push(g);
    }
  }
  const out = order.flatMap((o) => (typeof o === 'number' ? members.get(o)! : [o]));
  return out.every((row, k) => row === rows[k]) ? rows : out;
}

/** The rows that start a group after another group: each gets the line above it (none above the table's first row). */
export function groupStarts(rows: readonly { id: string }[], groupOf: (id: string) => number | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  let last: number | undefined;
  rows.forEach((row, k) => {
    const g = groupOf(row.id);
    if (k > 0 && g !== undefined && g !== last) out.add(row.id);
    last = g;
  });
  return out;
}

export const duplicateMarks = (rows: readonly { id: string }[], model: Pick<OrganizeModel, 'duplicateKept' | 'duplicateGroupOf'>): DuplicateMarks => ({
  kept: model.duplicateKept,
  starts: groupStarts(rows, model.duplicateGroupOf),
});

/** How many groups a clean-up of these items' groups leaves: the groups none of them is in. */
export function groupsLeftAfter(groups: readonly (readonly string[])[], chosen: readonly string[]): number {
  const picked = new Set(chosen);
  return groups.filter((g) => !g.some((id) => picked.has(id))).length;
}
