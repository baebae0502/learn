import { describe, expect, it } from 'vitest';
import { TAG_COLORS, type OrganizeSnapshot, type OrganizeTag } from '@learn/domain';
import { withTagColor, withTagMerged, withTagRemoved, withTagRenamed, withTagged } from './organizeCache';

const tag = (id: string, name: string, position: number | null = null): OrganizeTag => ({ id, name, color: position === null ? null : TAG_COLORS[position - 1]!.id, position });
const BASE: OrganizeSnapshot = {
  collections: [],
  tags: [tag('a', '중요', 1), tag('b', '복습'), tag('c', '질문')],
  members: {},
  tagged: { a: ['i1', 'i2'], b: ['i2', 'i3'] },
  duplicates: [],
};
const frozen = JSON.stringify(BASE);
const byId = (s: OrganizeSnapshot, id: string) => s.tags.find((x) => x.id === id);

describe('the organize snapshot patched before the notice brings the real one (tags)', () => {
  it('renames a tag in place', () => {
    const next = withTagRenamed(BASE, 'b', '다시 보기');
    expect(byId(next, 'b')?.name).toBe('다시 보기');
    expect(next.tags.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(next.tagged).toBe(BASE.tagged);
  });
  it('colours a tag by slot, and the tag that held the slot loses colour and slot with it — one change', () => {
    const next = withTagColor(BASE, 'b', 'yellow', 1);
    expect(byId(next, 'b')).toMatchObject({ color: 'yellow', position: 1 });
    expect(byId(next, 'a')).toMatchObject({ color: null, position: null });
    expect(next.tags.map((x) => x.id)).toEqual(['b', 'a', 'c']); // coloured first, as the database lists them
  });
  it('colours into a free slot without touching the others, and clears a colour with a null slot', () => {
    const next = withTagColor(BASE, 'c', 'green', 3);
    expect(next.tags.map((x) => [x.id, x.position])).toEqual([['a', 1], ['c', 3], ['b', null]]);
    const cleared = withTagColor(BASE, 'a', null, null);
    expect(byId(cleared, 'a')).toMatchObject({ color: null, position: null });
    expect(cleared.tags.filter((x) => x.position !== null)).toEqual([]);
  });
  it('removes a tag and its items', () => {
    const next = withTagRemoved(BASE, 'a');
    expect(next.tags.map((x) => x.id)).toEqual(['b', 'c']);
    expect(next.tagged).toEqual({ b: ['i2', 'i3'] });
  });
  it('merges one tag into another: the items are the union without repeats, the other stays as it is, this one is gone', () => {
    const next = withTagMerged(BASE, 'a', 'b');
    expect(next.tags.map((x) => x.id)).toEqual(['b', 'c']);
    expect(next.tagged).toEqual({ b: ['i2', 'i3', 'i1'] });
    expect(byId(next, 'b')).toEqual(byId(BASE, 'b'));
    expect(withTagMerged(BASE, 'c', 'a').tagged).toEqual({ a: ['i1', 'i2'], b: ['i2', 'i3'] }); // nothing to move
  });
  it('puts a tag on items or takes it off, keeping only the keys that have items (Q-2)', () => {
    expect(withTagged(BASE, 'c', ['i1', 'i1', 'i4'], true).tagged.c).toEqual(['i1', 'i4']);
    expect(withTagged(BASE, 'a', ['i3'], true).tagged.a).toEqual(['i1', 'i2', 'i3']);
    expect(withTagged(BASE, 'a', ['i1'], false).tagged.a).toEqual(['i2']);
    expect('a' in withTagged(BASE, 'a', ['i1', 'i2', 'i9'], false).tagged).toBe(false);
  });
  it('never changes the snapshot it was given', () => {
    withTagColor(BASE, 'b', 'yellow', 1);
    withTagMerged(BASE, 'a', 'b');
    withTagRemoved(BASE, 'a');
    withTagged(BASE, 'a', ['i1'], false);
    expect(JSON.stringify(BASE)).toBe(frozen);
  });
});
