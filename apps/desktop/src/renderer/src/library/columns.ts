import {
  COLUMN_WIDTH_MAX, DEFAULT_COLUMN_CONFIG, LIBRARY_COLUMNS, LIBRARY_COLUMN_IDS, columnSpec,
  type ColumnConfig, type LibraryColumnId, type LibraryColumnSpec,
} from '@learn/domain';

const isColumnId = (v: unknown): v is LibraryColumnId => typeof v === 'string' && (LIBRARY_COLUMN_IDS as readonly string[]).includes(v);
const clampWidth = (id: LibraryColumnId, w: number): number => Math.min(COLUMN_WIDTH_MAX, Math.max(columnSpec(id).minWidth, Math.round(w)));

/** A fresh copy of the default column set (열 구성 되돌리기). */
export const defaultColumns = (): ColumnConfig => ({
  visible: [...DEFAULT_COLUMN_CONFIG.visible],
  order: [...DEFAULT_COLUMN_CONFIG.order],
  widths: { ...DEFAULT_COLUMN_CONFIG.widths },
});

/**
 * library.columns as stored (spec §3.2) → a usable configuration: ids this build does not know are dropped (a later
 * milestone's value still reads), 제목 is always shown, widths are whole pixels in [the column's minimum, 1200], and the
 * title has none (it takes the remaining width). Anything unreadable is the default set.
 */
export function parseColumnConfig(raw: unknown): ColumnConfig {
  if (typeof raw !== 'object' || raw === null) return defaultColumns();
  const r = raw as Record<string, unknown>;
  const ids = (v: unknown): LibraryColumnId[] | null => (Array.isArray(v) ? [...new Set(v.filter(isColumnId))] : null);
  const shown = ids(r['visible']);
  if (shown === null) return defaultColumns();
  const visible = LIBRARY_COLUMN_IDS.filter((id) => id === 'title' || shown.includes(id));
  const ordered = ids(r['order']) ?? [];
  const order = [...ordered, ...LIBRARY_COLUMN_IDS.filter((id) => !ordered.includes(id))];
  const widths: Partial<Record<LibraryColumnId, number>> = {};
  const w = r['widths'];
  if (typeof w === 'object' && w !== null) {
    for (const [k, v] of Object.entries(w)) if (isColumnId(k) && k !== 'title' && typeof v === 'number' && Number.isFinite(v)) widths[k] = clampWidth(k, v);
  }
  return { visible, order, widths };
}

/** Shows or hides a column (the column header menu); the title cannot be hidden. The visible list keeps catalogue order. */
export function toggleColumn(cfg: ColumnConfig, id: LibraryColumnId): ColumnConfig {
  if (columnSpec(id).required) return cfg;
  const on = cfg.visible.includes(id);
  return { ...cfg, visible: LIBRARY_COLUMN_IDS.filter((c) => (c === id ? !on : cfg.visible.includes(c))) };
}

/**
 * The shown columns, in catalogue order (`order` is not used yet). `forced` columns are shown whatever the config says and
 * sit right after the title: the recent view's 마지막으로 연 날 (spec 3.2).
 */
export function visibleColumns(cfg: ColumnConfig, forced: readonly LibraryColumnId[] = []): LibraryColumnSpec[] {
  const shown = LIBRARY_COLUMNS.filter((c) => cfg.visible.includes(c.id) || forced.includes(c.id));
  if (forced.length === 0) return shown;
  return [...shown.filter((c) => c.id === 'title'), ...shown.filter((c) => c.id !== 'title' && forced.includes(c.id)), ...shown.filter((c) => c.id !== 'title' && !forced.includes(c.id))];
}

/** A column's width in pixels: the stored one, else its default; null for the title (the rest of the table). */
export const widthOf = (cfg: ColumnConfig, spec: LibraryColumnSpec): number | null => (spec.defaultWidth === null ? null : (cfg.widths[spec.id] ?? spec.defaultWidth));

/** The configuration with these widths stored (clamped; the title's is never kept). */
export function withWidths(cfg: ColumnConfig, widths: ReadonlyMap<LibraryColumnId, number>): ColumnConfig {
  const next = { ...cfg.widths };
  for (const [id, w] of widths) if (id !== 'title') next[id] = clampWidth(id, w);
  return { ...cfg, widths: next };
}

/**
 * One step of a column drag (neighbours trade width): `resized` wants `width`; the column right of it gives or takes the same amount,
 * both within [minimum, 1200]. The title is never stored: dragging its edge moves width to or from the column after it,
 * and it takes whatever the others leave. `start` holds every shown column's pixel width when the drag began. Returns
 * the widths of the shown columns other than the title.
 */
export function tradeWidths(
  visible: readonly LibraryColumnSpec[],
  start: ReadonlyMap<LibraryColumnId, number>,
  resized: LibraryColumnId,
  width: number,
): Map<LibraryColumnId, number> {
  const out = new Map<LibraryColumnId, number>();
  for (const c of visible) if (c.id !== 'title') out.set(c.id, start.get(c.id) ?? c.defaultWidth ?? c.minWidth);
  const at = visible.findIndex((c) => c.id === resized);
  const self = visible[at];
  const next = visible[at + 1];
  if (!self || !next) return out;
  const was = start.get(self.id) ?? 0;
  const nextWas = out.get(next.id)!;
  const clampNext = (w: number) => Math.min(COLUMN_WIDTH_MAX, Math.max(next.minWidth, Math.round(w)));
  if (self.id === 'title') {
    out.set(next.id, clampNext(nextWas - (width - was)));
    return out;
  }
  const wanted = Math.min(COLUMN_WIDTH_MAX, Math.max(self.minWidth, Math.round(width)));
  const nextNow = clampNext(nextWas - (wanted - was));
  out.set(next.id, nextNow);
  out.set(self.id, was + (nextWas - nextNow));
  return out;
}

/** The shown columns' pixel widths, the title's excepted: stored, else the default (the grid's tracks). */
export const fixedWidths = (cfg: ColumnConfig, visible: readonly LibraryColumnSpec[]): Map<LibraryColumnId, number> =>
  new Map(visible.flatMap((c) => (c.defaultWidth === null ? [] : [[c.id, widthOf(cfg, c)!] as const])));

/** How far a row's fill sits in from the table's sides (design-spec 6 표: 표 몸통은 좌우 8 안쪽). */
export const ROW_INSET = 8;

/**
 * The CSS grid tracks of the header and of the rows, and the table's least width (wider than the view, it scrolls
 * sideways). Every column but the title has its width; the title takes the rest, at least its minimum. A row is inset
 * 8 px on both sides while its cells line up with the header's: its first and last tracks are 8 px narrower, and those
 * two cells reach back out by a negative margin (styles: .table-row .td.is-first / .is-last).
 */
export function columnTemplates(visible: readonly LibraryColumnSpec[], widths: ReadonlyMap<LibraryColumnId, number>): { head: string; row: string; minWidth: number } {
  const last = visible.length - 1;
  const head: string[] = [];
  const row: string[] = [];
  let minWidth = 0;
  visible.forEach((c, i) => {
    const inset = (i === 0 ? ROW_INSET : 0) + (i === last ? ROW_INSET : 0);
    const width = c.defaultWidth === null ? null : (widths.get(c.id) ?? c.defaultWidth);
    if (width === null) {
      head.push(`minmax(${c.minWidth}px, 1fr)`);
      row.push(`minmax(${c.minWidth - inset}px, 1fr)`);
      minWidth += c.minWidth;
    } else {
      head.push(`${width}px`);
      row.push(`${width - inset}px`);
      minWidth += width;
    }
  });
  return { head: head.join(' '), row: row.join(' '), minWidth };
}
