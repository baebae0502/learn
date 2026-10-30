import type { SettingKey } from '@learn/domain';
import { ApiError, api, unwrap } from '../api';
import { queryClient } from './query-client';

/** The cache entry of a library setting: the same key the readers use (`keys.columns` is `settingKey('library.columns')`). */
export const settingKey = (key: SettingKey) => ['settings', key] as const;

/**
 * Optimistic: the screen follows at once. A refused write keeps the screen as chosen and logs the code only (the next
 * change writes the whole value again).
 */
export function saveSetting(key: SettingKey, value: unknown): void {
  queryClient.setQueryData(settingKey(key), value);
  void unwrap(api().settings.set({ key, value })).catch((e: unknown) => console.warn(`[settings] saving ${key} failed: ${e instanceof ApiError ? e.code : 'INTERNAL'}`));
}
