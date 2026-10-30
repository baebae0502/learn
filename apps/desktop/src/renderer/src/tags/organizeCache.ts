import type { OrganizeSnapshot, OrganizeTag, TagColorId } from '@learn/domain';

type Tagged = OrganizeSnapshot['tagged'];

/** The database lists tags with a slot first by slot, then the others: the same here, so a patched snapshot reads like a fresh one. */
function listed(tags: readonly OrganizeTag[]): OrganizeTag[] {
  const slotted = tags.filter((tag) => tag.position !== null).sort((a, b) => a.position! - b.position!);
  return [...slotted, ...tags.filter((tag) => tag.position === null)];
}
const without = (tagged: Tagged, tagId: string): Tagged => Object.fromEntries(Object.entries(tagged).filter(([id]) => id !== tagId));

export function withTagRenamed(s: OrganizeSnapshot, tagId: string, name: string): OrganizeSnapshot {
  return { ...s, tags: s.tags.map((tag) => (tag.id === tagId ? { ...tag, name } : tag)) };
}

/** Colour and slot together (an app-wide pair): the tag that held the slot loses both. */
export function withTagColor(s: OrganizeSnapshot, tagId: string, color: TagColorId | null, position: number | null): OrganizeSnapshot {
  const tags = s.tags.map((tag): OrganizeTag => {
    if (tag.id === tagId) return { ...tag, color, position };
    return position !== null && tag.position === position ? { ...tag, color: null, position: null } : tag;
  });
  return { ...s, tags: listed(tags) };
}

export function withTagRemoved(s: OrganizeSnapshot, tagId: string): OrganizeSnapshot {
  return { ...s, tags: s.tags.filter((tag) => tag.id !== tagId), tagged: without(s.tagged, tagId) };
}

/** `fromId` is merged into `intoId`: its items go to the other tag (no repeats), which keeps its own name, colour and slot. */
export function withTagMerged(s: OrganizeSnapshot, fromId: string, intoId: string): OrganizeSnapshot {
  const union = [...new Set([...(s.tagged[intoId] ?? []), ...(s.tagged[fromId] ?? [])])];
  const tagged = without(s.tagged, fromId);
  if (union.length > 0) tagged[intoId] = union;
  return { ...s, tags: s.tags.filter((tag) => tag.id !== fromId), tagged };
}

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
