import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, type Prefs, type Result } from '@learn/domain';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';

const getPrefs = vi.fn<() => Promise<Result<Prefs>>>();
const setPrefs = vi.fn<(patch: Partial<Prefs>) => Promise<Result<Prefs>>>();
vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({ prefs: { get: getPrefs, set: setPrefs } }) }));

const { saveTranslationPrefs } = await import('./prefs');

const stored: Prefs = { ...DEFAULT_PREFS, translation: { ...DEFAULT_PREFS.translation, enabled: null, from: 'en', to: 'ja', autoOnSelect: false } };

beforeEach(() => {
  queryClient.clear();
  getPrefs.mockReset();
  setPrefs.mockReset();
  getPrefs.mockResolvedValue({ ok: true, data: stored });
  setPrefs.mockImplementation(async (patch) => ({ ok: true, data: { ...stored, ...patch } }));
});

describe('saving the translation choice before the preferences were read', () => {
  it('reads the stored ones first and keeps their languages', async () => {
    await saveTranslationPrefs({ enabled: true });
    expect(getPrefs).toHaveBeenCalledTimes(1);
    expect(setPrefs).toHaveBeenCalledWith({ translation: { ...stored.translation, enabled: true } });
  });
  it('does not read again when the cache has them', async () => {
    queryClient.setQueryData(keys.prefs, stored);
    await saveTranslationPrefs({ enabled: false });
    expect(getPrefs).not.toHaveBeenCalled();
    expect(setPrefs).toHaveBeenCalledWith({ translation: { ...stored.translation, enabled: false } });
  });
});
