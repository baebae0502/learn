import { describe, expect, it } from 'vitest';
import { formatDate } from '../format';
import { hasInfo, infoRows, partialDate } from './infoRows';

const times = { createdAt: '2026-10-20T11:40:00.000Z', updatedAt: '2026-10-21T00:30:00.000Z' };
const now = new Date(2026, 9, 23, 12, 0);

describe('정보 rows (spec §5.3)', () => {
  it('reads a year as a year and a month or a day as a date (design-spec 9 dates)', () => {
    expect(partialDate('2024')).toEqual({ label: '연도', value: '2024' });
    expect(partialDate('2024-03')).toEqual({ label: '날짜', value: '2024. 3.' });
    expect(partialDate('2024-03-15')).toEqual({ label: '날짜', value: '2024. 3. 15.' });
  });
  it('lists only the fields that have a value, in the spec order, then 추가일 · 수정일 always', () => {
    const rows = infoRows(
      {
        creators: [{ name: '한서진', role: 'author' }, { name: '윤재하', role: 'editor' }],
        date: '2024-03', publisher: '학습출판', language: '', url: 'https://example.org/a', abstract: '요약입니다.', extra: '6장 전체',
      },
      times,
      now,
    );
    expect(rows.map((r) => r.field)).toEqual(['creators', 'date', 'publisher', 'url', 'abstract', 'extra', 'createdAt', 'updatedAt']);
    expect(rows[0]).toMatchObject({ label: '저자', value: '한서진, 윤재하 (편집자)' });
    expect(rows.find((r) => r.field === 'url')).toMatchObject({ kind: 'link', value: 'https://example.org/a' });
    expect(rows.find((r) => r.field === 'abstract')?.kind).toBe('long');
    expect(rows.find((r) => r.field === 'extra')?.kind).toBe('note');
    expect(rows.at(-2)).toMatchObject({ label: '추가일', value: formatDate(times.createdAt, now) });
    expect(rows.at(-1)?.title).toContain('2026');
  });
  it('knows an item with no info at all (whitespace counts as nothing)', () => {
    expect(hasInfo({ creators: [] })).toBe(false);
    expect(hasInfo({ creators: [], publisher: '   ' })).toBe(false);
    expect(hasInfo({ creators: [], language: 'ko' })).toBe(true);
    expect(hasInfo({ creators: [{ name: '김하린', role: 'other' }] })).toBe(true);
    expect(infoRows({ creators: [] }, times, now).map((r) => r.field)).toEqual(['createdAt', 'updatedAt']);
  });
});
