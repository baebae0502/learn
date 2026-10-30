import { describe, expect, it } from 'vitest';
import type { LibraryItem, LibraryScope, OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from './model';
import { item } from './testing';
import { RECENT_DAYS, recentItems, resolveScope, restorableScope, sameScope, scopeItems, scopeLabel, scopePath } from './scope';

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const at = '2026-10-01T00:00:00.000Z';
const ITEMS: LibraryItem[] = [
  item('new', { openedAt: ago(1) }),
  item('edge', { openedAt: ago(RECENT_DAYS) }), // exactly 30 days: in
  item('old', { openedAt: ago(RECENT_DAYS + 0.001) }),
  item('never', { openedAt: null }),
  item('broken', { openedAt: 'not a date' }),
  item('filed'),
  item('loose'),
];
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: at },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: at },
  ],
  tags: [],
  members: { bio: ['filed'], c6: ['new'] },
  tagged: {},
  duplicates: [['old', 'never']],
};
const model = buildOrganizeModel(SNAPSHOT, ITEMS);
const idsOf = (xs: readonly LibraryItem[]) => xs.map((i) => i.id);
const ALL: LibraryScope = { kind: 'all' };

describe('the four scopes (spec 3.2)', () => {
  it('recent: opened within 30 days of the injected now, the boundary in, never-opened and unreadable dates out, list order kept', () => {
    expect(RECENT_DAYS).toBe(30);
    expect(idsOf(recentItems(ITEMS, NOW))).toEqual(['new', 'edge']);
    expect(idsOf(recentItems(ITEMS, NOW + 2 * DAY))).toEqual(['new']);
    expect(idsOf(scopeItems(model, ITEMS, { kind: 'recent' }, NOW))).toEqual(['new', 'edge']);
  });
  it('all returns the list itself', () => {
    expect(scopeItems(model, ITEMS, ALL, NOW)).toBe(ITEMS);
  });
  it('a collection shows its items and its descendants\' in list order; an unknown collection shows none', () => {
    expect(idsOf(scopeItems(model, ITEMS, { kind: 'collection', id: 'bio' }, NOW))).toEqual(['new', 'filed']);
    expect(idsOf(scopeItems(model, ITEMS, { kind: 'collection', id: 'c6' }, NOW))).toEqual(['new']);
    expect(scopeItems(model, ITEMS, { kind: 'collection', id: 'nope' }, NOW)).toEqual([]);
  });
  it('unfiled is the items in no collection; duplicates the items of a group', () => {
    expect(idsOf(scopeItems(model, ITEMS, { kind: 'unfiled' }, NOW))).toEqual(['edge', 'old', 'never', 'broken', 'loose']);
    expect(idsOf(scopeItems(model, ITEMS, { kind: 'duplicates' }, NOW))).toEqual(['old', 'never']);
  });
  it('without a model only all and recent have anything to show', () => {
    expect(scopeItems(undefined, ITEMS, { kind: 'recent' }, NOW)).toHaveLength(2);
    expect(scopeItems(undefined, ITEMS, ALL, NOW)).toBe(ITEMS);
  });
});

describe('names and equality', () => {
  it('names a scope, a collection by its own name and the full path as the tooltip', () => {
    expect(scopeLabel(model, ALL)).toBe('내 라이브러리');
    expect(scopeLabel(model, { kind: 'recent' })).toBe('최근 연 자료');
    expect(scopeLabel(model, { kind: 'unfiled' })).toBe('미분류');
    expect(scopeLabel(model, { kind: 'duplicates' })).toBe('중복 항목');
    expect(scopeLabel(model, { kind: 'collection', id: 'c6' })).toBe('6장');
    expect(scopePath(model, { kind: 'collection', id: 'c6' })).toBe('분자생물학 › 6장');
    expect(scopePath(model, { kind: 'collection', id: 'bio' })).toBe('분자생물학');
    expect(scopePath(model, { kind: 'recent' })).toBeUndefined();
    expect(scopeLabel(undefined, { kind: 'recent' })).toBe('최근 연 자료');
    expect(scopeLabel(model, { kind: 'collection', id: 'nope' })).toBe('내 라이브러리');
  });
  it('compares scopes by kind, and collections by id', () => {
    expect(sameScope({ kind: 'all' }, { kind: 'all' })).toBe(true);
    expect(sameScope({ kind: 'all' }, { kind: 'recent' })).toBe(false);
    expect(sameScope({ kind: 'collection', id: 'a' }, { kind: 'collection', id: 'a' })).toBe(true);
    expect(sameScope({ kind: 'collection', id: 'a' }, { kind: 'collection', id: 'b' })).toBe(false);
  });
});

describe('what the table shows when the stored scope cannot be shown', () => {
  it('a collection that is gone, or any view that needs the snapshot before it came, is all', () => {
    expect(resolveScope(model, { kind: 'collection', id: 'nope' })).toEqual(ALL);
    expect(resolveScope(model, { kind: 'collection', id: 'bio' })).toEqual({ kind: 'collection', id: 'bio' });
    expect(resolveScope(undefined, { kind: 'collection', id: 'bio' })).toEqual(ALL);
    expect(resolveScope(undefined, { kind: 'unfiled' })).toEqual(ALL);
    expect(resolveScope(undefined, { kind: 'duplicates' })).toEqual(ALL);
    expect(resolveScope(undefined, { kind: 'recent' })).toEqual({ kind: 'recent' });
  });
});

describe('the view restored at start (spec 3.1)', () => {
  it('opens a stored scope that still has what it needs', () => {
    const bioId = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    const live = buildOrganizeModel({ ...SNAPSHOT, collections: [{ id: bioId, name: '분자생물학', parentId: null, createdAt: at }], members: {} }, ITEMS);
    expect(restorableScope({ kind: 'collection', id: bioId }, live, ITEMS, NOW)).toEqual({ kind: 'collection', id: bioId });
    expect(restorableScope({ kind: 'recent' }, model, ITEMS, NOW)).toEqual({ kind: 'recent' });
    expect(restorableScope({ kind: 'unfiled' }, model, ITEMS, NOW)).toEqual({ kind: 'unfiled' });
    expect(restorableScope({ kind: 'duplicates' }, model, ITEMS, NOW)).toEqual({ kind: 'duplicates' });
    expect(restorableScope({ kind: 'all' }, model, ITEMS, NOW)).toEqual(ALL);
  });
  it('falls back to all: nothing stored, garbage, a collection that is gone, a special view without content', () => {
    for (const raw of [null, undefined, 'recent', { kind: 'trash' }, { kind: 'collection', id: 'bio' } /* not a uuid */]) expect(restorableScope(raw, model, ITEMS, NOW)).toEqual(ALL);
    const ghost = { kind: 'collection', id: '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d' };
    expect(restorableScope(ghost, model, ITEMS, NOW)).toEqual(ALL);
    expect(restorableScope({ kind: 'recent' }, model, ITEMS, NOW + 40 * DAY)).toEqual(ALL);
    const none = buildOrganizeModel({ ...SNAPSHOT, duplicates: [], collections: [], members: {} }, ITEMS);
    expect(restorableScope({ kind: 'duplicates' }, none, ITEMS, NOW)).toEqual(ALL);
    expect(restorableScope({ kind: 'unfiled' }, none, ITEMS, NOW)).toEqual(ALL); // no collection at all: the view is not offered
    const allFiled = buildOrganizeModel({ ...SNAPSHOT, members: { bio: ITEMS.map((i) => i.id) } }, ITEMS);
    expect(restorableScope({ kind: 'unfiled' }, allFiled, ITEMS, NOW)).toEqual(ALL);
  });
  it('without the snapshot only all and recent can open', () => {
    expect(restorableScope({ kind: 'recent' }, undefined, ITEMS, NOW)).toEqual({ kind: 'recent' });
    expect(restorableScope({ kind: 'duplicates' }, undefined, ITEMS, NOW)).toEqual(ALL);
  });
});
