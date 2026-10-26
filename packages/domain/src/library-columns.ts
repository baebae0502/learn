// The library table's column catalogue (M4 spec 3.1). No zod: main builds the column header menu from it and the
// renderer draws the header and the cells from it, so the menu and the header name every column alike.
export const LIBRARY_COLUMN_IDS = ['title', 'creators', 'year', 'type', 'createdAt', 'updatedAt', 'storageMode', 'size', 'originalName'] as const;
export type LibraryColumnId = (typeof LIBRARY_COLUMN_IDS)[number];

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
  { id: 'storageMode', label: '보관', defaultVisible: false, defaultWidth: 96, minWidth: 80, align: 'start' },
  { id: 'size', label: '크기', defaultVisible: false, defaultWidth: 80, minWidth: 64, align: 'end' },
  { id: 'originalName', label: '원래 파일 이름', defaultVisible: false, defaultWidth: 200, minWidth: 120, align: 'start' },
] satisfies LibraryColumnSpec[]);

/** The widest a column may be dragged (spec §3.2). */
export const COLUMN_WIDTH_MAX = 1200;

/** library.columns (spec §3.2). `order` is stored only: M4 never reorders (header dragging comes with M5's DnD). */
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
