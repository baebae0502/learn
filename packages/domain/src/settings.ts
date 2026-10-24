import { z } from 'zod';
import { COMMAND_IDS } from './commands';
import { LearnError } from './errors';
import { COLUMN_WIDTH_MAX } from './library-columns';

/** Sortable fields. openedAt / progress have no column until M7; the rest are LIBRARY_COLUMN_IDS (spec §3.1). */
export const LIBRARY_SORT_COLUMNS = ['title', 'creators', 'year', 'type', 'createdAt', 'openedAt', 'progress', 'updatedAt', 'storageMode', 'size', 'originalName'] as const;

const storedColumnId = z.string().min(1).max(64);
/**
 * library.columns (spec §3.2). Column ids stay plain strings here: a value written by a later milestone (a column added
 * or dropped) must still read back; the renderer's parseColumnConfig drops the ids it does not know and clamps widths to
 * each column's minimum.
 */
export const columnConfigSchema = z.object({
  visible: z.array(storedColumnId).max(64),
  order: z.array(storedColumnId).max(64),
  widths: z.record(storedColumnId, z.number().int().min(0).max(COLUMN_WIDTH_MAX)),
});

/** Library-scoped settings (stored in the library DB). */
export const SETTINGS = {
  'library.sort': z.object({ column: z.enum(LIBRARY_SORT_COLUMNS), direction: z.enum(['asc', 'desc']) }),
  'library.columns': columnConfigSchema,
  'layout.panes': z.record(z.string(), z.number().int().min(0).max(4000)),
  'ui.lastOpenItemId': z.uuid().nullable(),
  /** The commands last run from the ⌘K palette, newest first (spec §4.4): an id that is gone makes the whole value unreadable, and the history starts over. */
  'palette.recent': z.array(z.enum(COMMAND_IDS)).max(20),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTINGS, key);

export function parseSetting(key: string, value: unknown): unknown {
  if (!isSettingKey(key)) throw new LearnError('VALIDATION_FAILED', '알 수 없는 설정 항목입니다.');
  const r = SETTINGS[key].safeParse(value);
  if (!r.success) throw new LearnError('VALIDATION_FAILED', '설정 값이 올바르지 않습니다.');
  return r.data;
}

/**
 * Per-device preferences (stored outside the library). Values follow the approved design spec
 * (docs/design/design-spec.md §3.2 rows 24/28/32, §10.6 text size 12–15 pt).
 */
export const prefsFields = {
  theme: z.enum(['system', 'light', 'dark']),
  density: z.enum(['compact', 'regular', 'comfortable']),
  /** UI text size in pt (lists, menus, panels; reader content zooms separately). */
  fontSize: z.union([z.literal(12), z.literal(13), z.literal(14), z.literal(15)]),
  libraryRoot: z.string().min(1).nullable(),
};
export const prefsSchema = z.object({
  theme: prefsFields.theme.default('system'),
  density: prefsFields.density.default('regular'),
  fontSize: prefsFields.fontSize.default(13),
  libraryRoot: prefsFields.libraryRoot.default(null),
});
export type Prefs = z.infer<typeof prefsSchema>;
/** All defaults: what a window falls back to when reading the prefs failed. */
export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze(prefsSchema.parse({}));
