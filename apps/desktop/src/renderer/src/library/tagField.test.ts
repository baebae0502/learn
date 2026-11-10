import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { NO_TAG_NAMES } from './search';
import { tagNamesFor } from './tagField';

const ITEMS = ['i1', 'i2', 'i3'].map((id) => item(id));
const snapshot = (over: Partial<OrganizeSnapshot> = {}): OrganizeSnapshot => ({
  collections: [],
  tags: [
    { id: 't1', name: '중요', color: 'yellow', position: 1 },
    { id: 't2', name: 'G 단백질', color: null, position: null },
  ],
  members: {},
  tagged: { t1: ['i1', 'i2', 'ghost'], t2: ['i1'] },
  duplicates: [],
  trashCount: 0,
  ...over,
});

describe('the search index\'s tag field (spec 7.1)', () => {
  it('lists each tagged item\'s tag names joined by a space, in name order, and nothing for an item without a tag or one that left the list', () => {
    const names = tagNamesFor(buildOrganizeModel(snapshot(), ITEMS));
    expect([...names]).toEqual([['i1', 'G 단백질 중요'], ['i2', '중요']]);
    expect(names.has('i3')).toBe(false);
    expect(names.has('ghost')).toBe(false);
  });

  it('is the same map when only the colours (and so the model\'s tag order) of two tags change', () => {
    const named = (a: [string | null, number | null], b: [string | null, number | null]) =>
      snapshot({
        tags: [
          { id: 't1', name: '중요', color: a[0] as 'yellow' | null, position: a[1] },
          { id: 't2', name: 'G 단백질', color: b[0] as 'red' | null, position: b[1] },
        ].sort((x, y) => (x.position ?? 99) - (y.position ?? 99)),
      });
    const before = tagNamesFor(buildOrganizeModel(named(['yellow', 1], [null, null]), ITEMS));
    const swapped = tagNamesFor(buildOrganizeModel(named([null, null], ['red', 1]), ITEMS));
    expect(buildOrganizeModel(named([null, null], ['red', 1]), ITEMS).tags[0]!.id).toBe('t2'); // the model's order did change
    expect(swapped).toBe(before);
  });

  it('is empty before the snapshot has come', () => {
    expect(tagNamesFor(undefined)).toBe(NO_TAG_NAMES);
    expect(NO_TAG_NAMES.size).toBe(0);
  });

  it('is the same map for a model built again from the same tags and assignments — a collection edit renews the snapshot, not the index', () => {
    const first = tagNamesFor(buildOrganizeModel(snapshot(), ITEMS));
    const edited = snapshot({ collections: [{ id: 'c', name: '통계', parentId: null, createdAt: '2026-10-01T00:00:00.000Z' }], members: { c: ['i3'] } });
    expect(tagNamesFor(buildOrganizeModel(edited, ITEMS))).toBe(first);
  });

  it('is a new map when a name or an assignment changes', () => {
    const first = tagNamesFor(buildOrganizeModel(snapshot(), ITEMS));
    const renamed = snapshot({ tags: [{ id: 't1', name: '핵심', color: 'yellow', position: 1 }, { id: 't2', name: 'G 단백질', color: null, position: null }] });
    const second = tagNamesFor(buildOrganizeModel(renamed, ITEMS));
    expect(second).not.toBe(first);
    expect(second.get('i2')).toBe('핵심');
    const moved = tagNamesFor(buildOrganizeModel(snapshot({ tagged: { t1: ['i1'], t2: ['i1', 'i3'] } }), ITEMS));
    expect(moved).not.toBe(second);
    expect(moved.get('i3')).toBe('G 단백질');
  });

  it('asks the model once: the same model answers from memory', () => {
    const model = buildOrganizeModel(snapshot(), ITEMS);
    expect(tagNamesFor(model)).toBe(tagNamesFor(model));
  });
});
