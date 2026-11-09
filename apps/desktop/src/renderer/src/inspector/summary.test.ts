import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { libraryStats, multiSummary } from './summary';

let n = 0;
const item = (type: LibraryItem['type'], size: number): LibraryItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, title: `t${n}`, type, mime: type === 'pdf' ? 'application/pdf' : type === 'image' ? 'image/png' : 'video/mp4', size,
  storageMode: 'managed', availability: 'available', assetId: 'a', revisionId: 'r', originalName: 'x', createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z', creators: [], year: null, progress: null, openedAt: null, publisher: null,
});

describe('item panel summaries (spec §5.4, library.html none / multi)', () => {
  it('states the view: its name, count, kinds that have items, total size; breaks only at the middots', () => {
    expect(libraryStats('내 라이브러리', [item('pdf', 1_000_000), item('pdf', 1_000_000), item('video', 900_000)])).toBe('내 라이브러리\u00a0· 자료 3개(PDF 2\u00a0· 동영상 1)\u00a0· 2.9 MB');
    expect(libraryStats('분자생물학', [item('pdf', 1761)])).toBe('분자생물학\u00a0· 자료 1개(PDF 1)\u00a0· 1.8 KB');
  });
  it('a view without items says so, with no kinds and no size', () => {
    expect(libraryStats('학회 준비', [])).toBe('학회 준비\u00a0· 자료 0개');
  });
  it('the trash adds its collections after the items part, only when there are some', () => {
    const items = [item('pdf', 1_000_000), item('video', 900_000), item('video', 900_000)];
    expect(libraryStats('휴지통', items, 1)).toBe('휴지통\u00a0· 자료 3개(PDF\u00a01\u00a0· 동영상\u00a02)\u00a0· 컬렉션 1개\u00a0· 2.8\u00a0MB');
    expect(libraryStats('휴지통', items, 0)).toBe('휴지통\u00a0· 자료 3개(PDF\u00a01\u00a0· 동영상\u00a02)\u00a0· 2.8\u00a0MB');
    expect(libraryStats('휴지통', [], 2)).toBe('휴지통\u00a0· 자료 0개\u00a0· 컬렉션 2개');
  });
  it('counts images beside the other kinds, and leaves the kind out when there are none', () => {
    expect(libraryStats('내 라이브러리', [item('pdf', 1_000_000), item('video', 900_000), item('image', 100_000), item('image', 100_000)])).toBe('내 라이브러리\u00a0· 자료 4개(PDF 1\u00a0· 동영상 1\u00a0· 이미지 2)\u00a0· 2.1 MB');
    expect(libraryStats('사진', [item('image', 1761)])).toBe('사진\u00a0· 자료 1개(이미지 1)\u00a0· 1.8 KB');
    expect(libraryStats('내 라이브러리', [item('pdf', 1_000_000)])).not.toContain('이미지');
  });
  it('names images in a multiple selection', () => {
    expect(multiSummary([item('pdf', 4_000_000), item('pdf', 5_000_000), item('image', 800_000)])).toBe('PDF 2개\u00a0· 이미지 1개\u00a0· 합계 9.8 MB');
    expect(multiSummary([item('pdf', 1000), item('video', 1000), item('image', 1000)])).toBe('PDF 1개\u00a0· 동영상 1개\u00a0· 이미지 1개\u00a0· 합계 3.0 KB');
  });
  it('sums up a multiple selection: kinds with 개, then 합계', () => {
    expect(multiSummary([item('pdf', 4_000_000), item('pdf', 5_000_000), item('video', 800_000)])).toBe('PDF 2개\u00a0· 동영상 1개\u00a0· 합계 9.8 MB');
    expect(multiSummary([item('video', 500), item('video', 500)])).toBe('동영상 2개\u00a0· 합계 1.0 KB');
  });
});
