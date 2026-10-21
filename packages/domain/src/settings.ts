import { z } from 'zod';
import { LearnError } from './errors';

export const LIBRARY_SORT_COLUMNS = ['title', 'creators', 'year', 'type', 'createdAt', 'openedAt', 'progress'] as const;

/** Library-scoped settings (stored in the library DB). */
export const SETTINGS = {
  'library.sort': z.object({ column: z.enum(LIBRARY_SORT_COLUMNS), direction: z.enum(['asc', 'desc']) }),
  'layout.panes': z.record(z.string(), z.number().int().min(0).max(4000)),
  'ui.lastOpenItemId': z.uuid().nullable(),
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
