import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMN_CONFIG, LIBRARY_COLUMNS, LIBRARY_COLUMN_IDS, type ColumnConfig, type LibraryColumnId } from '@learn/domain';
import { columnTemplates, completeOrder, defaultColumns, fixedWidths, moveColumn, parseColumnConfig, pinnedCount, toggleColumn, tradeWidths, visibleColumns, widthOf, withWidths } from './columns';

const spec = (id: LibraryColumnId) => LIBRARY_COLUMNS.find((c) => c.id === id)!;
const px = (entries: Array<[LibraryColumnId, number]>) => new Map(entries);

describe('column configuration (M4 spec 3.2)', () => {
  it('reads nothing, garbage or a value without a visible list as the defaults', () => {
    for (const raw of [null, undefined, 3, 'x', {}, { visible: 'title' }]) expect(parseColumnConfig(raw)).toEqual(DEFAULT_COLUMN_CONFIG);
    expect(defaultColumns()).toEqual(DEFAULT_COLUMN_CONFIG);
    expect(defaultColumns().visible).not.toBe(DEFAULT_COLUMN_CONFIG.visible); // a copy the caller may change
  });
  it('drops ids it does not know, keeps the title visible, lists the shown columns in catalogue order', () => {
    const cfg = parseColumnConfig({ visible: ['size', 'tags', 'year', 'year'], order: ['tags', 'size'], widths: {} });
    expect(cfg.visible).toEqual(['title', 'year', 'size']);
    expect(cfg.order).toEqual(['title', 'creators', 'year', 'type', 'createdAt', 'updatedAt', 'openedAt', 'storageMode', 'size', 'originalName']);
  });
  it('clamps widths to [the column minimum, 1200], rounds them, and never keeps one for the title (it takes the rest)', () => {
    const cfg = parseColumnConfig({ visible: ['title'], order: [], widths: { creators: 20, year: 2000, size: 81.6, title: 400, tags: 50, type: 'wide' } });
    expect(cfg.widths).toEqual({ creators: 96, year: 1200, size: 82 });
  });
  it('drops a width whose id is not a known column or whose value is not a number, so the stored record stays small (Q-95)', () => {
    const junk = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`gone-${i}`, 100]));
    const cfg = parseColumnConfig({ visible: ['title'], order: [], widths: { ...junk, year: 70, size: Number.NaN, type: '88' } });
    expect(cfg.widths).toEqual({ year: 70 });
  });
  it('toggles a column in and out in catalogue order without changing its input; the title stays', () => {
    const base = defaultColumns();
    expect(toggleColumn(base, 'size').visible).toEqual(['title', 'creators', 'year', 'type', 'createdAt', 'size']);
    expect(toggleColumn(base, 'year').visible).toEqual(['title', 'creators', 'type', 'createdAt']);
    expect(toggleColumn(base, 'title')).toBe(base);
    expect(base.visible).toEqual(DEFAULT_COLUMN_CONFIG.visible);
  });
  it('gives the shown columns as specs, and each one\'s width: stored, else its default, null for the title', () => {
    const cfg = withWidths(defaultColumns(), px([['creators', 150], ['title', 999]]));
    expect(visibleColumns(cfg).map((c) => c.id)).toEqual(['title', 'creators', 'year', 'type', 'createdAt']);
    expect(cfg.widths).toEqual({ creators: 150 });
    expect(widthOf(cfg, spec('creators'))).toBe(150);
    expect(widthOf(cfg, spec('year'))).toBe(64);
    expect(widthOf(cfg, spec('title'))).toBeNull();
  });
  it('a forced column is shown whatever the config says, right after the title', () => {
    const cfg = defaultColumns();
    expect(visibleColumns(cfg, ['openedAt']).map((c) => c.id)).toEqual(['title', 'openedAt', 'creators', 'year', 'type', 'createdAt']);
    expect(visibleColumns(cfg).map((c) => c.id)).toEqual(['title', 'creators', 'year', 'type', 'createdAt']);
    const shown = toggleColumn(cfg, 'openedAt');
    expect(visibleColumns(shown, ['openedAt']).map((c) => c.id)).toEqual(['title', 'openedAt', 'creators', 'year', 'type', 'createdAt']); // not twice
  });
});

describe('resizing a column trades width with the next one (M4 spec 3.2, ruling 6; Zotero 7)', () => {
  const shown = (['title', 'creators', 'year', 'type', 'createdAt'] as const).map(spec);
  const start = px([['title', 500], ['creators', 180], ['year', 64], ['type', 88], ['createdAt', 132]]);
  it('a column grows or shrinks and its right neighbour gives or takes the same width; the title keeps its own', () => {
    expect(tradeWidths(shown, start, 'creators', 140)).toEqual(px([['creators', 140], ['year', 104], ['type', 88], ['createdAt', 132]]));
    expect(tradeWidths(shown, start, 'type', 100)).toEqual(px([['creators', 180], ['year', 64], ['type', 100], ['createdAt', 120]]));
  });
  it('stops where either of the two reaches its minimum', () => {
    expect(tradeWidths(shown, start, 'creators', 250)).toEqual(px([['creators', 188], ['year', 56], ['type', 88], ['createdAt', 132]]));
    expect(tradeWidths(shown, start, 'type', 10)).toEqual(px([['creators', 180], ['year', 64], ['type', 72], ['createdAt', 148]]));
  });
  it('the title\'s edge moves by trading with the first column after it', () => {
    expect(tradeWidths(shown, start, 'title', 540)).toEqual(px([['creators', 140], ['year', 64], ['type', 88], ['createdAt', 132]]));
    expect(tradeWidths(shown, start, 'title', 470)).toEqual(px([['creators', 210], ['year', 64], ['type', 88], ['createdAt', 132]]));
    expect(tradeWidths(shown, start, 'title', 700).get('creators')).toBe(96);
  });
  it('changes nothing for the last column (no right neighbour, so no handle) or a column not shown', () => {
    const unchanged = px([['creators', 180], ['year', 64], ['type', 88], ['createdAt', 132]]);
    expect(tradeWidths(shown, start, 'createdAt', 200)).toEqual(unchanged);
    expect(tradeWidths(shown, start, 'size', 200)).toEqual(unchanged);
  });
});

describe('the grid tracks of the header and the rows (M4 spec 3.1, 3.2)', () => {
  it('gives every column its width and the title the rest at its minimum; the table is never narrower than their sum', () => {
    const cfg = withWidths(defaultColumns(), px([['creators', 140]]));
    const shown = visibleColumns(cfg);
    expect(fixedWidths(cfg, shown)).toEqual(px([['creators', 140], ['year', 64], ['type', 88], ['createdAt', 132]]));
    expect(columnTemplates(shown, fixedWidths(cfg, shown))).toEqual({
      head: 'minmax(200px, 1fr) 140px 64px 88px 132px',
      row: 'minmax(192px, 1fr) 140px 64px 88px 124px', // the row is inset 8 on each side; its cells line up with the header
      minWidth: 624,
    });
  });
  it('takes the widths it is given over the stored ones (a drag in progress)', () => {
    const shown = visibleColumns(defaultColumns());
    expect(columnTemplates(shown, px([['creators', 150], ['year', 94]])).head).toBe('minmax(200px, 1fr) 150px 94px 88px 132px');
  });
  it('a table of the title alone: one track, inset on both sides in a row', () => {
    const shown = visibleColumns(parseColumnConfig({ visible: ['title'] }));
    expect(columnTemplates(shown, new Map())).toEqual({ head: 'minmax(200px, 1fr)', row: 'minmax(184px, 1fr)', minWidth: 200 });
  });
});

describe('column order (M5 spec 5.1)', () => {
  const ids = (cfg: ColumnConfig, forced: readonly LibraryColumnId[] = []) => visibleColumns(cfg, forced).map((c) => c.id);
  const base = defaultColumns(); // shown: title, creators, year, type, createdAt

  it('puts the title first whatever was stored and a column the build added right after its catalogue predecessor', () => {
    expect(completeOrder(['size', 'title', 'year'])).toEqual(['title', 'creators', 'size', 'originalName', 'year', 'type', 'createdAt', 'updatedAt', 'openedAt', 'storageMode']);
    // M4 stored nine ids, in catalogue order: 마지막으로 연 날 lands after 수정일, not at the end.
    const m4 = ['title', 'creators', 'year', 'type', 'createdAt', 'updatedAt', 'storageMode', 'size', 'originalName'] as const;
    expect(completeOrder(m4)).toEqual([...LIBRARY_COLUMN_IDS]);
    expect(completeOrder([])).toEqual([...LIBRARY_COLUMN_IDS]);
    expect(completeOrder(['year', 'year'])).toEqual([...LIBRARY_COLUMN_IDS]); // a repeated id is listed once
  });
  it('shows the columns in the stored order; a forced column sits right after the title, the others keep their order', () => {
    const cfg = { ...base, order: completeOrder(['title', 'createdAt', 'creators', 'year', 'type']) };
    expect(ids(cfg)).toEqual(['title', 'createdAt', 'creators', 'year', 'type']);
    expect(ids(cfg, ['openedAt'])).toEqual(['title', 'openedAt', 'createdAt', 'creators', 'year', 'type']);
    expect(ids(base)).toEqual(['title', 'creators', 'year', 'type', 'createdAt']);
  });
  it('pins the title and the forced columns shown after it', () => {
    expect(pinnedCount(['title', 'creators'], [])).toBe(1);
    expect(pinnedCount(['title', 'openedAt', 'creators'], ['openedAt'])).toBe(2);
    expect(pinnedCount(['title', 'creators'], ['openedAt'])).toBe(1); // a forced column that is not shown pins nothing
  });
  it('moves a column to a boundary between the shown columns: 0 is before the first, n after the last', () => {
    const left = moveColumn(base, [], 'createdAt', 1);
    expect(ids(left)).toEqual(['title', 'createdAt', 'creators', 'year', 'type']);
    expect(left.order).toEqual(['title', 'createdAt', 'creators', 'year', 'type', 'updatedAt', 'openedAt', 'storageMode', 'size', 'originalName']);
    expect(ids(moveColumn(base, [], 'creators', 5))).toEqual(['title', 'year', 'type', 'createdAt', 'creators']);
    expect(ids(moveColumn(base, [], 'year', 4))).toEqual(['title', 'creators', 'type', 'year', 'createdAt']);
    expect(ids(moveColumn(base, [], 'year', 1))).toEqual(['title', 'year', 'creators', 'type', 'createdAt']);
    expect(base.order).toEqual([...LIBRARY_COLUMN_IDS]); // the input is not changed
  });
  it('leaves hidden columns where they were, relative to the shown ones', () => {
    const wide = toggleColumn(base, 'updatedAt'); // shown: …, createdAt, updatedAt
    const moved = moveColumn(wide, [], 'updatedAt', 1);
    expect(ids(moved)).toEqual(['title', 'updatedAt', 'creators', 'year', 'type', 'createdAt']);
    expect(moved.order).toEqual(['title', 'updatedAt', 'creators', 'year', 'type', 'createdAt', 'openedAt', 'storageMode', 'size', 'originalName']);
  });
  it('changes nothing when the column would land where it is, when it is the title or not shown, or the boundary is not one it may take', () => {
    for (const [id, slot] of [['year', 2], ['year', 3], ['title', 3], ['size', 1], ['year', 0], ['year', 99], ['year', -1]] as const) {
      expect(moveColumn(base, [], id, slot), `${id} → ${slot}`).toBe(base);
    }
  });
  it('keeps a forced column right after the title: nothing goes before it and it cannot be moved', () => {
    expect(moveColumn(base, ['openedAt'], 'createdAt', 1)).toBe(base); // before the forced column
    expect(moveColumn(base, ['openedAt'], 'openedAt', 4)).toBe(base);
    const moved = moveColumn(base, ['openedAt'], 'createdAt', 2); // right after it
    expect(ids(moved, ['openedAt'])).toEqual(['title', 'openedAt', 'createdAt', 'creators', 'year', 'type']);
    expect(ids(moved)).toEqual(['title', 'createdAt', 'creators', 'year', 'type']); // outside the recent view the order is the same
  });
  it('열 구성 되돌리기 brings the order back with the widths and the shown columns', () => {
    expect(defaultColumns().order).toEqual([...LIBRARY_COLUMN_IDS]);
    expect(defaultColumns()).toEqual(DEFAULT_COLUMN_CONFIG);
  });
});
