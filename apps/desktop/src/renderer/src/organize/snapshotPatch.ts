import type { OrganizeSnapshot, OrganizeTag } from '@learn/domain';

/** `list`, then the ids of `ids` it lacks, once each. */
function joined(list: readonly string[] | undefined, ids: readonly string[]): string[] {
  const out = list ? [...list] : [];
  const seen = new Set(out);
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function without(list: readonly string[], ids: readonly string[]): string[] {
  const gone = new Set(ids);
  return list.filter((id) => !gone.has(id));
}

/** The record with `key` set to `list`, or without the key when the list is empty: the snapshot carries non-empty keys only. */
function put(record: Readonly<Record<string, string[]>>, key: string, list: string[]): Record<string, string[]> {
  const next = { ...record };
  if (list.length === 0) delete next[key];
  else next[key] = list;
  return next;
}

/**
 * The snapshot with a change applied before main's notice brings the real one (pure, never mutating): the screen then
 * shows the result at once, and the next calculation — a second 컬렉션에 추가, the "already in" marks — sees it.
 */
export function withMembers(s: OrganizeSnapshot, collectionId: string, ids: readonly string[]): OrganizeSnapshot {
  if (!s.collections.some((c) => c.id === collectionId)) return s;
  return { ...s, members: put(s.members, collectionId, joined(s.members[collectionId], ids)) };
}

export function withoutMembers(s: OrganizeSnapshot, collectionId: string, ids: readonly string[]): OrganizeSnapshot {
  const held = s.members[collectionId];
  return held === undefined ? s : { ...s, members: put(s.members, collectionId, without(held, ids)) };
}

/** A tag just created, at the end of the list (it has no slot yet); a tag the snapshot has is left as it is. */
export function withTag(s: OrganizeSnapshot, tag: OrganizeTag): OrganizeSnapshot {
  return s.tags.some((t) => t.id === tag.id) ? s : { ...s, tags: [...s.tags, tag] };
}
