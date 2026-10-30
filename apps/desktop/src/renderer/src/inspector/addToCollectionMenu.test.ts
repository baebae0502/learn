import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { addToCollectionEntries, collectionOfKey } from './addToCollectionMenu';

const AT = '2026-10-01T00:00:00.000Z';
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'stat', name: '통계', parentId: null, createdAt: AT },
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
  ],
  tags: [],
  members: { bio: ['a', 'b'], c6: ['a'] },
  tagged: {},
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, ['a', 'b', 'c'].map((id) => item(id)));
type Row = { id: string; label?: string; indent?: number; marked?: boolean; isDisabled?: boolean; accelerator?: string };
/** The entries flat: the collections' section opened up, a separator as '-'. */
const flat = (ids: string[]): Array<Row | '-'> =>
  addToCollectionEntries(model, ids).flatMap((e): Array<Row | '-'> => ('separator' in e ? ['-'] : 'items' in e ? (e.items as Row[]) : [e as Row]));

describe('컬렉션에 추가 ▾ (spec 6.2, design-spec 7.3)', () => {
  it('lists the collections in tree order with their depth, a separator, then 새 컬렉션 ⇧⌘N', () => {
    const shown = flat(['c']).map((r) => (r === '-' ? '-' : `${'>'.repeat(r.indent ?? 0)}${r.label}`));
    expect(shown).toEqual(['분자생물학', '>6장', '통계', '-', '새\u00a0컬렉션']);
    expect(flat(['c']).at(-1)).toMatchObject({ id: 'new', label: '새\u00a0컬렉션', accelerator: 'Shift+CmdOrCtrl+N' });
  });
  it('keeps the collections in a section of their own, so their marks are a group of checkboxes and 새 컬렉션 stays a plain action', () => {
    const entries = addToCollectionEntries(model, ['c']);
    expect(entries.map((e) => ('separator' in e ? 'separator' : 'items' in e ? 'section' : 'item'))).toEqual(['section', 'separator', 'item']);
  });
  it('marks and disables a collection that already holds every selected item, and only that', () => {
    const marks = (ids: string[]) => flat(ids).filter((r): r is Row => r !== '-' && r.id.startsWith('c:')).map((r) => [r.id, r.marked, r.isDisabled]);
    expect(marks(['a', 'b'])).toEqual([['c:bio', true, true], ['c:c6', false, false], ['c:stat', false, false]]);
    expect(marks(['a'])).toEqual([['c:bio', true, true], ['c:c6', true, true], ['c:stat', false, false]]);
    expect(marks(['a', 'c'])).toEqual([['c:bio', false, false], ['c:c6', false, false], ['c:stat', false, false]]);
  });
  it('with no collection yet it is 새 컬렉션 alone', () => {
    const empty = buildOrganizeModel({ ...SNAPSHOT, collections: [], members: {} }, []);
    expect(addToCollectionEntries(empty, ['a']).map((e) => ('separator' in e || 'items' in e ? '?' : e.id))).toEqual(['new']);
  });
  it('a key names its collection', () => {
    expect(collectionOfKey('c:bio')).toBe('bio');
    expect(collectionOfKey('new')).toBeNull();
  });
});
