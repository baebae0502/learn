// The library table's column catalogue (M4 spec 3.1). No zod: main builds the column header menu from it and the
// renderer draws the header and the cells from it, so the menu and the header name every column alike.
export const LIBRARY_COLUMN_IDS = ['title', 'creators', 'year', 'type', 'createdAt', 'updatedAt', 'openedAt', 'storageMode', 'size', 'originalName'] as const;
export type LibraryColumnId = (typeof LIBRARY_COLUMN_IDS)[number];

/** Sortable fields. `progress` has no column until M7; the rest are LIBRARY_COLUMN_IDS (spec §3.1). It lives here, not in settings.ts: command arguments need the type and settings.ts imports the command registry. */
export const LIBRARY_SORT_COLUMNS = ['title', 'creators', 'year', 'type', 'createdAt', 'openedAt', 'progress', 'updatedAt', 'storageMode', 'size', 'originalName'] as const;
export type LibrarySortColumn = (typeof LIBRARY_SORT_COLUMNS)[number];

/** The columns shown, as a bitmask over LIBRARY_COLUMN_IDS (bit i = the i-th id): the reported command context carries no arrays. */
export function columnsMask(ids: Iterable<LibraryColumnId>): number {
  let mask = 0;
  for (const id of ids) {
    const i = LIBRARY_COLUMN_IDS.indexOf(id);
    if (i >= 0) mask |= 1 << i;
  }
  return mask;
}

/** The ids a mask names, in catalogue order; a bit past the catalogue names nothing. */
export const columnsOfMask = (mask: number): LibraryColumnId[] => LIBRARY_COLUMN_IDS.filter((_, i) => (mask & (1 << i)) !== 0);

export interface LibraryColumnSpec {
  id: LibraryColumnId;
  /** Korean header (spec §3.1); also the column header menu's item. */
  label: string;
  defaultVisible: boolean;
  /** null: takes the remaining width (title). */
  defaultWidth: number | null;
  minWidth: number;
  align: 'start' | 'end';
  /** The title column cannot be hidden. */
  required?: true;
}

export const LIBRARY_COLUMNS: readonly LibraryColumnSpec[] = Object.freeze([
  { id: 'title', label: '제목', defaultVisible: true, defaultWidth: null, minWidth: 200, align: 'start', required: true },
  { id: 'creators', label: '저자', defaultVisible: true, defaultWidth: 180, minWidth: 96, align: 'start' },
  { id: 'year', label: '연도', defaultVisible: true, defaultWidth: 64, minWidth: 56, align: 'start' },
  { id: 'type', label: '종류', defaultVisible: true, defaultWidth: 88, minWidth: 72, align: 'start' },
  { id: 'createdAt', label: '추가일', defaultVisible: true, defaultWidth: 132, minWidth: 112, align: 'start' },
  { id: 'updatedAt', label: '수정일', defaultVisible: false, defaultWidth: 132, minWidth: 112, align: 'start' },
  { id: 'openedAt', label: '마지막으로 연 날', defaultVisible: false, defaultWidth: 132, minWidth: 112, align: 'start' },
  { id: 'storageMode', label: '보관', defaultVisible: false, defaultWidth: 96, minWidth: 80, align: 'start' },
  { id: 'size', label: '크기', defaultVisible: false, defaultWidth: 80, minWidth: 64, align: 'end' },
  { id: 'originalName', label: '원래 이름', defaultVisible: false, defaultWidth: 200, minWidth: 120, align: 'start' },
] satisfies LibraryColumnSpec[]);

/** The widest a column may be dragged (spec §3.2). */
export const COLUMN_WIDTH_MAX = 1200;

/** How many column ids library.columns stores in each of its lists and in its widths (a later build's ids included). */
export const STORED_COLUMN_IDS_MAX = 64;

/** library.columns (spec §3.2, M5 5.1): which columns show, in which order (the title first), and the widths the user dragged. */
export interface ColumnConfig {
  visible: LibraryColumnId[];
  order: LibraryColumnId[];
  widths: Partial<Record<LibraryColumnId, number>>;
}

export const DEFAULT_COLUMN_CONFIG: Readonly<ColumnConfig> = Object.freeze({
  visible: Object.freeze(LIBRARY_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id)) as LibraryColumnId[],
  order: Object.freeze([...LIBRARY_COLUMN_IDS]) as LibraryColumnId[],
  widths: Object.freeze({}),
});

export function columnSpec(id: LibraryColumnId): LibraryColumnSpec {
  const spec = LIBRARY_COLUMNS.find((c) => c.id === id);
  if (!spec) throw new Error(`unknown column: ${id}`);
  return spec;
}
