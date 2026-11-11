import { isSettingKey, parseSetting, type SettingKey } from '@learn/domain';

/** The library's settings table as far as the seed needs it. */
export interface SettingsStore {
  get(key: SettingKey): unknown;
  set(key: SettingKey, value: unknown): void;
}

/**
 * E2E only (LEARN_E2E=1, never packaged): LEARN_E2E_SETTINGS is a JSON object of library settings that are written at launch where
 * none is stored yet, before the window opens. A suite that is not about a setting's default starts from the value it needs (the
 * reader's right panel on 정보) without a reload; the specs of the default itself launch with the variable empty.
 * A value that is not valid for its key, or a key that does not exist, is skipped; nothing here can overwrite a stored value.
 */
export function seedE2ESettings(store: SettingsStore, raw: string | undefined): SettingKey[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const seeded: SettingKey[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!isSettingKey(key) || store.get(key) !== undefined) continue;
    try {
      store.set(key, parseSetting(key, value));
      seeded.push(key);
    } catch {
      // not valid for its key: left unset
    }
  }
  return seeded;
}
