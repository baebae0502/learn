import type { Collection, OrganizeSnapshot } from '@learn/domain';

/** A created collection, as the snapshot has it (the notice that follows brings the real snapshot; this is the frame between). */
export function withCollection(s: OrganizeSnapshot, c: Pick<Collection, 'id' | 'name' | 'parentId' | 'createdAt'>): OrganizeSnapshot {
  if (s.collections.some((x) => x.id === c.id)) return s;
  return { ...s, collections: [...s.collections, { id: c.id, name: c.name, parentId: c.parentId, createdAt: c.createdAt }] };
}

export function withRenamed(s: OrganizeSnapshot, id: string, name: string): OrganizeSnapshot {
  if (!s.collections.some((x) => x.id === id)) return s;
  return { ...s, collections: s.collections.map((x) => (x.id === id ? { ...x, name } : x)) };
}

/** Collections removed with their memberships (their items stay in the library). */
export function withoutCollections(s: OrganizeSnapshot, ids: ReadonlySet<string>): OrganizeSnapshot {
  return {
    ...s,
    collections: s.collections.filter((x) => !ids.has(x.id)),
    members: Object.fromEntries(Object.entries(s.members).filter(([id]) => !ids.has(id))),
  };
}
