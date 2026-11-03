import { DEFAULT_TRANSLATION_PREFS, type Prefs, type TranslationPrefs } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';

/** The saved choice, as this window has it (main broadcasts every change; the default until prefs are read). */
export const readTranslationPrefs = (): TranslationPrefs => queryClient.getQueryData<Prefs>(keys.prefs)?.translation ?? DEFAULT_TRANSLATION_PREFS;

/** The merge is shallow, so the whole object goes; the cache takes main's answer at once, not after the broadcast. Throws ApiError. */
export async function saveTranslationPrefs(patch: Partial<TranslationPrefs>): Promise<void> {
  const saved = await unwrap(api().prefs.set({ translation: { ...readTranslationPrefs(), ...patch } }));
  queryClient.setQueryData(keys.prefs, saved);
}
