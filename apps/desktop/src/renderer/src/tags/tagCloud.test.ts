import { describe, expect, it } from 'vitest';
import { TAG_COLORS, type OrganizeTag } from '@learn/domain';
import { cloudChips, viewCounts } from './tagCloud';

const tag = (id: string, name: string, position: number | null = null): OrganizeTag => ({ id, name, color: position === null ? null : TAG_COLORS[position - 1]!.id, position });
const TAGS = [tag('imp', '중요', 3), tag('rng', '시험 범위', 1), tag('rec', '수용체'), tag('hah', '하하'), tag('reg', '회귀분석'), tag('t10', '10장'), tag('t2', '2장'), tag('en', 'Receptor')];
const counts = (o: Record<string, number>) => new Map(Object.entries(o));
const ALL_IN_VIEW = counts({ imp: 1, rng: 1, rec: 1, hah: 1, reg: 1, t10: 1, t2: 1, en: 1 });
const NAME = { show: 'view', sort: 'name' } as const;
const ids = (chips: ReturnType<typeof cloudChips>) => chips.map((c) => c.tag.id);

describe('the chips of the selector (spec 4.3)', () => {
  it('lists the colour tags first by slot, the rest by name — numbers by value (2장 before 10장), Hangul before Latin as the Korean collator has it', () => {
    expect(ids(cloudChips({ tags: TAGS, counts: ALL_IN_VIEW, filter: new Set(), selector: NAME, query: '' }))).toEqual(['rng', 'imp', 't2', 't10', 'rec', 'hah', 'reg', 'en']);
  });
  it('sorts the rest by the number of items in the view when asked (ties by name), the colour tags still first by slot', () => {
    const c = counts({ imp: 1, rng: 1, rec: 1, hah: 2, reg: 0, t10: 5, t2: 5, en: 3 });
    expect(ids(cloudChips({ tags: TAGS, counts: c, filter: new Set(), selector: { show: 'view', sort: 'count' }, query: '' }))).toEqual(['rng', 'imp', 't2', 't10', 'en', 'hah', 'rec']);
  });
  it('shows only the tags the view has when asked (현재 보기의 태그만), and all of them — the ones the view lacks dim — otherwise', () => {
    const c = counts({ imp: 1, rng: 1, rec: 1, hah: 2, reg: 0, t10: 5, t2: 5, en: 3 });
    const view = cloudChips({ tags: TAGS, counts: c, filter: new Set(), selector: NAME, query: '' });
    expect(ids(view)).not.toContain('reg');
    const all = cloudChips({ tags: TAGS, counts: c, filter: new Set(), selector: { show: 'all', sort: 'name' }, query: '' });
    expect(all.filter((x) => x.dim).map((x) => x.tag.id)).toEqual(['reg']);
    expect(ids(all)).toEqual(['rng', 'imp', 't2', 't10', 'rec', 'hah', 'reg', 'en']); // the dim chip stays in its place by name
    expect(view.every((x) => !x.dim)).toBe(true);
  });
  it('keeps a tag that is in the filter however the view is, marked on and not dim, so it can be taken out again', () => {
    const c = counts({ imp: 1, rng: 1, rec: 1, hah: 1, reg: 0, t10: 1, t2: 1, en: 1 });
    const chips = cloudChips({ tags: TAGS, counts: c, filter: new Set(['reg', 'rec']), selector: NAME, query: '' });
    expect(chips.find((x) => x.tag.id === 'reg')).toMatchObject({ on: true, dim: false });
    expect(chips.find((x) => x.tag.id === 'rec')).toMatchObject({ on: true, dim: false });
    expect(chips.find((x) => x.tag.id === 'hah')).toMatchObject({ on: false, dim: false });
  });
  it('narrows by the filter field: NFC, case folded, 초성 — colour tags too', () => {
    const find = (query: string) => ids(cloudChips({ tags: TAGS, counts: ALL_IN_VIEW, filter: new Set(), selector: NAME, query }));
    expect(find('ㅅㅇㅊ')).toEqual(['rec']);
    expect(find('recep')).toEqual(['en']);
    expect(find('ㅅㅎ')).toEqual(['rng']);
    expect(find('  중요 ')).toEqual(['imp']);
    expect(find('없는 태그')).toEqual([]);
    expect(find('')).toHaveLength(8);
  });
});

describe('how many items of the view each tag has', () => {
  const sets: Record<string, Set<string>> = { imp: new Set(['a', 'b', 'c']), rng: new Set(['a']), rec: new Set() };
  const of = (id: string) => sets[id] ?? new Set<string>();
  it('counts the common items, whichever side is the smaller', () => {
    const three = TAGS.slice(0, 3);
    expect(viewCounts(three, of, new Set(['a', 'b', 'z']))).toEqual(new Map([['imp', 2], ['rng', 1], ['rec', 0]]));
    expect(viewCounts(three, of, new Set(['a', 'b', 'c', 'd', 'e', 'f']))).toEqual(new Map([['imp', 3], ['rng', 1], ['rec', 0]]));
    expect(viewCounts(three, of, new Set())).toEqual(new Map([['imp', 0], ['rng', 0], ['rec', 0]]));
  });
});
