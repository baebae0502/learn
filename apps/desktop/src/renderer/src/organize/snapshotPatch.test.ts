import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { withMembers, withTag, withoutMembers } from './snapshotPatch';

const AT = '2026-10-01T00:00:00.000Z';
const BASE: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
  ],
  tags: [{ id: 't1', name: '중요', color: 'yellow', position: 1 }],
  members: { bio: ['a', 'b'] },
  tagged: { t1: ['a'] },
  duplicates: [],
};

describe('patching the organize snapshot before the notice brings the real one', () => {
  it('files ids once each, after the ones already there, and a collection that was empty gets its key', () => {
    const next = withMembers(BASE, 'bio', ['b', 'c', 'c', 'd']);
    expect(next.members['bio']).toEqual(['a', 'b', 'c', 'd']);
    expect(withMembers(BASE, 'c6', ['a']).members).toEqual({ bio: ['a', 'b'], c6: ['a'] });
    expect(BASE.members['bio']).toEqual(['a', 'b']); // never mutates
  });
  it('a collection the snapshot does not have is left alone', () => {
    expect(withMembers(BASE, 'gone', ['a'])).toBe(BASE);
    expect(withoutMembers(BASE, 'gone', ['a'])).toBe(BASE);
  });
  it('takes ids out, and drops the key of a collection that is empty (the snapshot carries non-empty keys only)', () => {
    expect(withoutMembers(BASE, 'bio', ['a']).members).toEqual({ bio: ['b'] });
    expect(withoutMembers(BASE, 'bio', ['a', 'b', 'zz']).members).toEqual({});
    expect(withoutMembers(BASE, 'c6', ['a'])).toBe(BASE); // nothing was there
  });
  it('adds a created tag once, at the end (a new tag has no slot)', () => {
    const made = { id: 't2', name: '수용체', color: null, position: null };
    const next = withTag(BASE, made);
    expect(next.tags.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(withTag(next, made)).toBe(next);
    expect(withTag(BASE, BASE.tags[0]!)).toBe(BASE);
  });
});
