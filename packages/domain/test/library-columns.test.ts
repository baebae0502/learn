import { describe, expect, it } from 'vitest';
import { newId } from '../src/ids';
import { showColumnMenuInput, showContextMenuInput } from '../src/ipc';
import { COLUMN_WIDTH_MAX, DEFAULT_COLUMN_CONFIG, LIBRARY_COLUMNS, LIBRARY_COLUMN_IDS, columnSpec } from '../src/library-columns';
import { LIBRARY_SORT_COLUMNS } from '../src/settings';

describe('library table columns (M4 spec 3.1)', () => {
  it('lists the nine columns in catalogue order with the spec labels, widths and alignment', () => {
    expect(LIBRARY_COLUMNS.map((c) => c.id)).toEqual([...LIBRARY_COLUMN_IDS]);
    expect(LIBRARY_COLUMNS.map((c) => [c.id, c.label, c.defaultWidth, c.minWidth, c.align, c.defaultVisible])).toEqual([
      ['title', '제목', null, 200, 'start', true],
      ['creators', '저자', 180, 96, 'start', true],
      ['year', '연도', 64, 56, 'start', true],
      ['type', '종류', 88, 72, 'start', true],
      ['createdAt', '추가일', 132, 112, 'start', true],
      ['updatedAt', '수정일', 132, 112, 'start', false],
      ['storageMode', '보관', 96, 80, 'start', false],
      ['size', '크기', 80, 64, 'end', false],
      ['originalName', '원래 파일 이름', 200, 120, 'start', false],
    ]);
  });
  it('only the title is required, and only the title takes the remaining width', () => {
    expect(LIBRARY_COLUMNS.filter((c) => c.required).map((c) => c.id)).toEqual(['title']);
    expect(LIBRARY_COLUMNS.filter((c) => c.defaultWidth === null).map((c) => c.id)).toEqual(['title']);
    for (const c of LIBRARY_COLUMNS) if (c.defaultWidth !== null) expect(c.minWidth <= c.defaultWidth && c.defaultWidth <= COLUMN_WIDTH_MAX, c.id).toBe(true);
    expect(COLUMN_WIDTH_MAX).toBe(1200);
  });
  it('starts with the five default columns, the catalogue order and no stored widths (frozen)', () => {
    expect(DEFAULT_COLUMN_CONFIG).toEqual({ visible: ['title', 'creators', 'year', 'type', 'createdAt'], order: [...LIBRARY_COLUMN_IDS], widths: {} });
    expect(Object.isFrozen(DEFAULT_COLUMN_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COLUMN_CONFIG.visible)).toBe(true);
    expect(columnSpec('size').align).toBe('end');
  });
  it('every column is also a sort column (library.sort)', () => {
    for (const id of LIBRARY_COLUMN_IDS) expect(LIBRARY_SORT_COLUMNS).toContain(id);
  });
});

describe('table IPC inputs', () => {
  it('the column menu takes the shown columns and a point; unknown ids and extra keys are refused (P-9)', () => {
    expect(showColumnMenuInput.parse({ visible: ['title', 'year'], x: 10, y: 20 })).toEqual({ visible: ['title', 'year'], x: 10, y: 20 });
    expect(showColumnMenuInput.safeParse({ visible: ['tags'], x: 0, y: 0 }).success).toBe(false);
    expect(showColumnMenuInput.safeParse({ visible: [], x: 0, y: 0, extra: 1 }).success).toBe(false);
  });
  it('the item menu takes the whole selection of a large library (⌘A on 10 000 rows); the column kind is gone', () => {
    const itemIds = Array.from({ length: 10_000 }, () => newId());
    expect(showContextMenuInput.safeParse({ kind: 'item', itemIds, x: 0, y: 0 }).success).toBe(true);
    expect(showContextMenuInput.safeParse({ kind: 'column', columnId: 'title', x: 0, y: 0 }).success).toBe(false);
  });
});
