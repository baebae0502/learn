import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMN_CONFIG, LIBRARY_COLUMNS, type LibraryColumnId } from '@learn/domain';
import { columnTemplates, defaultColumns, fixedWidths, parseColumnConfig, toggleColumn, tradeWidths, visibleColumns, widthOf, withWidths } from './columns';

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
    expect(cfg.order).toEqual(['size', 'title', 'creators', 'year', 'type', 'createdAt', 'updatedAt', 'openedAt', 'storageMode', 'originalName']);
  });
  it('clamps widths to [the column minimum, 1200], rounds them, and never keeps one for the title (it takes the rest)', () => {
    const cfg = parseColumnConfig({ visible: ['title'], order: [], widths: { creators: 20, year: 2000, size: 81.6, title: 400, tags: 50, type: 'wide' } });
    expect(cfg.widths).toEqual({ creators: 96, year: 1200, size: 82 });
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
