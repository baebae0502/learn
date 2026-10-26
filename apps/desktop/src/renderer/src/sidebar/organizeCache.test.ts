import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { withCollection, withRenamed, withoutCollections } from './organizeCache';

const AT = '2026-10-01T00:00:00.000Z';
const BASE: OrganizeSnapshot = {
  collections: [
    { id: 'a', name: 'A', parentId: null, createdAt: AT },
    { id: 'b', name: 'B', parentId: 'a', createdAt: AT },
    { id: 'c', name: 'C', parentId: 'b', createdAt: AT },
  ],
  tags: [{ id: 't', name: '시험', color: null, position: null }],
  members: { a: ['i1'], b: ['i2'], c: ['i3'] },
  tagged: { t: ['i1'] },
  duplicates: [['i1', 'i2']],
};

describe('patching the organize snapshot before the notice brings the real one', () => {
  it('adds a created collection once, as the snapshot has them', () => {
    const made = { id: 'n', name: '새 컬렉션', parentId: 'a', itemCount: 0, createdAt: AT, updatedAt: null };
    const next = withCollection(BASE, made);
    expect(next.collections.at(-1)).toEqual({ id: 'n', name: '새 컬렉션', parentId: 'a', createdAt: AT });
    expect(next.collections).toHaveLength(4);
    expect(withCollection(next, made)).toBe(next);
    expect(BASE.collections).toHaveLength(3);
  });
  it('renames one collection and nothing else', () => {
    const next = withRenamed(BASE, 'b', '둘째');
    expect(next.collections.map((c) => c.name)).toEqual(['A', '둘째', 'C']);
    expect(withRenamed(BASE, 'nope', 'x')).toEqual(BASE);
  });
  it('removes a set of collections with their memberships and leaves tags and duplicates alone', () => {
    const next = withoutCollections(BASE, new Set(['b', 'c']));
    expect(next.collections.map((c) => c.id)).toEqual(['a']);
    expect(next.members).toEqual({ a: ['i1'] });
    expect(next.tags).toBe(BASE.tags);
    expect(next.tagged).toBe(BASE.tagged);
    expect(next.duplicates).toBe(BASE.duplicates);
    expect(Object.keys(BASE.members)).toEqual(['a', 'b', 'c']);
  });
});
