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
 * A key that does not exist, a value that is not valid for its key, or text that is not a JSON object throws, naming the key: a mistyped
 * seed must not quietly seed nothing. Nothing here overwrites a stored value; a failure of the store itself is its own error.
 */
export function seedE2ESettings(store: SettingsStore, raw: string | undefined): SettingKey[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('LEARN_E2E_SETTINGS is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('LEARN_E2E_SETTINGS is not a JSON object');
  const seeded: SettingKey[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!isSettingKey(key)) throw new Error(`LEARN_E2E_SETTINGS: unknown setting "${key}"`);
    if (store.get(key) !== undefined) continue;
    let valid: unknown;
    try {
      valid = parseSetting(key, value);
    } catch {
      throw new Error(`LEARN_E2E_SETTINGS: the value for "${key}" is not valid`);
    }
    store.set(key, valid);
    seeded.push(key);
  }
  return seeded;
}
