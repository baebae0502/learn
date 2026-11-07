import { DEFAULT_TRANSLATION_PREFS, type Prefs, type TranslationPrefs } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';

/** The saved choice, as this window has it (main broadcasts every change; the default until prefs are read). */
export const readTranslationPrefs = (): TranslationPrefs => queryClient.getQueryData<Prefs>(keys.prefs)?.translation ?? DEFAULT_TRANSLATION_PREFS;

/**
 * The merge is shallow, so the whole object goes; the cache takes main's answer at once, not after the broadcast. The stored
 * choice is read first when this window has not (a failed first read): defaults must not overwrite saved languages. Throws ApiError.
 */
export async function saveTranslationPrefs(patch: Partial<TranslationPrefs>): Promise<void> {
  const current = await queryClient.fetchQuery({ queryKey: keys.prefs, queryFn: () => unwrap(api().prefs.get()) });
  const saved = await unwrap(api().prefs.set({ translation: { ...current.translation, ...patch } }));
  queryClient.setQueryData(keys.prefs, saved);
}
