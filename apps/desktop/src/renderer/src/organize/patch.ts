import type { OrganizeSnapshot } from '@learn/domain';

/** The tag put on (`assigned`) or taken off these items. A tag with no item has no key. */
export function withTagged(s: OrganizeSnapshot, tagId: string, itemIds: readonly string[], assigned: boolean): OrganizeSnapshot {
  const current = s.tagged[tagId] ?? [];
  const gone = new Set(itemIds);
  const next = assigned ? [...new Set([...current, ...itemIds])] : current.filter((id) => !gone.has(id));
  const tagged = { ...s.tagged };
  if (next.length > 0) tagged[tagId] = next;
  else delete tagged[tagId];
  return { ...s, tagged };
}
