import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { DEFAULT_SORT, firstDirection, parseSort, sortItems } from './sort';

let n = 0;
const item = (over: Partial<LibraryItem>): LibraryItem => ({
  id: `id-${String(++n).padStart(3, '0')}`, title: 't', type: 'pdf', mime: 'application/pdf', size: 1, storageMode: 'managed',
  availability: 'available', assetId: 'a', revisionId: 'r', originalName: 'f.pdf', createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z', creators: [], year: null, tagIds: [], progress: null, openedAt: null, ...over,
});
const titles = (items: readonly LibraryItem[]) => items.map((i) => i.title);

describe('library sort (M4 spec 3.1)', () => {
  it('compares text with the Korean collator: Hangul first, numbers by value, case ignored', () => {
    const items = [item({ title: '효소 반응' }), item({ title: 'Chapter 10' }), item({ title: '가설 검정' }), item({ title: 'chapter 2' }), item({ title: '나선 구조' })];
    expect(titles(sortItems(items, { column: 'title', direction: 'asc' }))).toEqual(['가설 검정', '나선 구조', '효소 반응', 'chapter 2', 'Chapter 10']);
    expect(titles(sortItems(items, { column: 'title', direction: 'desc' }))).toEqual(['Chapter 10', 'chapter 2', '효소 반응', '나선 구조', '가설 검정']);
  });
  it('puts empty values last whichever the direction (no year, no creators); creators sort by the first', () => {
    const years = [item({ title: 'a', year: null }), item({ title: 'b', year: 2001 }), item({ title: 'c', year: 1999 })];
    expect(titles(sortItems(years, { column: 'year', direction: 'asc' }))).toEqual(['c', 'b', 'a']);
    expect(titles(sortItems(years, { column: 'year', direction: 'desc' }))).toEqual(['b', 'c', 'a']);
    const people = [item({ title: 'x' }), item({ title: 'y', creators: ['박지훈', '김민지'] }), item({ title: 'z', creators: ['김민지'] })];
    expect(titles(sortItems(people, { column: 'creators', direction: 'asc' }))).toEqual(['z', 'y', 'x']);
    expect(titles(sortItems(people, { column: 'creators', direction: 'desc' }))).toEqual(['y', 'z', 'x']);
  });
  it('breaks ties by 추가일 newest first, then keeps the list\'s own order (the repository\'s), in both directions', () => {
    const items = [
      item({ id: 'b', title: 'same', createdAt: '2026-10-02T00:00:00.000Z' }),
      item({ id: 'c', title: 'same', createdAt: '2026-10-03T00:00:00.000Z' }),
      item({ id: 'a', title: 'same', createdAt: '2026-10-02T00:00:00.000Z' }),
    ];
    expect(sortItems(items, { column: 'title', direction: 'asc' }).map((i) => i.id)).toEqual(['c', 'b', 'a']);
    expect(sortItems(items, { column: 'title', direction: 'desc' }).map((i) => i.id)).toEqual(['c', 'b', 'a']);
    // Two files of one import can share 추가일 to the millisecond: the list's order (created_at DESC, rowid DESC) stays.
    expect(sortItems(items, { column: 'createdAt', direction: 'desc' }).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
  it('sorts times, sizes, kinds and storage by value, and never changes its input', () => {
    const items = [
      item({ title: 'old video', type: 'video', size: 3000, storageMode: 'linked', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' }),
      item({ title: 'new pdf', size: 200, createdAt: '2026-10-01T00:00:00.000Z' }),
    ];
    const before = [...items];
    expect(titles(sortItems(items, DEFAULT_SORT))).toEqual(['new pdf', 'old video']);
    expect(titles(sortItems(items, { column: 'updatedAt', direction: 'desc' }))).toEqual(['old video', 'new pdf']);
    expect(titles(sortItems(items, { column: 'size', direction: 'asc' }))).toEqual(['new pdf', 'old video']);
    expect(titles(sortItems(items, { column: 'type', direction: 'asc' }))).toEqual(['new pdf', 'old video']); // PDF, then 동영상
    expect(titles(sortItems(items, { column: 'storageMode', direction: 'asc' }))).toEqual(['new pdf', 'old video']); // 사본, then 외부 연결
    expect(items).toEqual(before);
  });
  it('reads a stored sort, else 추가일 newest first', () => {
    expect(DEFAULT_SORT).toEqual({ column: 'createdAt', direction: 'desc' });
    expect(parseSort({ column: 'size', direction: 'asc' })).toEqual({ column: 'size', direction: 'asc' });
    for (const raw of [null, { column: 'tags', direction: 'asc' }, { column: 'title', direction: 'up' }]) expect(parseSort(raw)).toEqual(DEFAULT_SORT);
  });
  it('a first press sorts dates and sizes newest or largest first, the rest A to Z (Finder; ruling 7)', () => {
    expect((['createdAt', 'updatedAt', 'openedAt', 'size', 'progress'] as const).map((c) => firstDirection(c))).toEqual(['desc', 'desc', 'desc', 'desc', 'desc']);
    expect((['title', 'creators', 'year', 'type', 'storageMode', 'originalName'] as const).map((c) => firstDirection(c))).toEqual(['asc', 'asc', 'asc', 'asc', 'asc', 'asc']);
  });
});
