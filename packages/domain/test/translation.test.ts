import { describe, expect, it } from 'vitest';
import { ERROR_CODES, LearnError } from '../src/errors';
import { translateInput } from '../src/ipc';
import { DEFAULT_TRANSLATION_PREFS, TRANSLATION_CACHE_MAX, TRANSLATION_CHUNK_CHARS, TRANSLATION_LANGS, TRANSLATION_MAX_CHARS, translationPrefsSchema } from '../src/translation';
import { prefsSchema } from '../src/settings';
import { prefsPatchInput, prefsSetInput } from '../src/ipc';
import { Channels } from '../src/ipc-channels';

describe('translation domain', () => {
  it('has the agreed languages and limits', () => {
    expect(TRANSLATION_LANGS).toEqual(['ko', 'en', 'ja', 'zh-CN', 'de', 'fr', 'es']);
    expect([TRANSLATION_MAX_CHARS, TRANSLATION_CHUNK_CHARS, TRANSLATION_CACHE_MAX]).toEqual([5000, 4500, 2000]);
  });
  it('translateInput is strict and bounded', () => {
    expect(translateInput.safeParse({ text: 'a', from: 'auto', to: 'ko' }).success).toBe(true);
    expect(translateInput.safeParse({ text: '', from: 'auto', to: 'ko' }).success).toBe(false);
    expect(translateInput.safeParse({ text: 'a'.repeat(20001), from: 'auto', to: 'ko' }).success).toBe(false);
    expect(translateInput.safeParse({ text: 'a', from: 'xx', to: 'ko' }).success).toBe(false);
    expect(translateInput.safeParse({ text: 'a', from: 'auto', to: 'auto' }).success).toBe(false);
    expect(translateInput.safeParse({ text: 'a', from: 'auto', to: 'ko', extra: 1 }).success).toBe(false);
  });
  it('prefs carry the translation block, off until the user decides', () => {
    expect(DEFAULT_TRANSLATION_PREFS).toEqual({ enabled: null, autoOnSelect: true, from: 'auto', to: 'ko' });
    expect(prefsSchema.parse({}).translation).toEqual(DEFAULT_TRANSLATION_PREFS);
    expect(translationPrefsSchema.safeParse({ ...DEFAULT_TRANSLATION_PREFS, to: 'auto' }).success).toBe(false);
    expect(translationPrefsSchema.safeParse({ ...DEFAULT_TRANSLATION_PREFS, extra: 1 }).success).toBe(false);
    const t = { enabled: true, autoOnSelect: false, from: 'en', to: 'ja' } as const;
    expect(prefsSetInput.parse({ translation: t })).toEqual({ translation: t });
    expect(prefsPatchInput.parse({ translation: t })).toEqual({ translation: t });
  });
  it('has the seven error codes, retryable for offline, rate limit and unavailable only', () => {
    const codes = ['TRANSLATION_OFFLINE', 'TRANSLATION_RATE_LIMITED', 'TRANSLATION_BLOCKED', 'TRANSLATION_UNAVAILABLE', 'TRANSLATION_BAD_RESPONSE', 'TRANSLATION_DISABLED', 'TRANSLATION_TOO_LONG'] as const;
    for (const c of codes) {
      expect(ERROR_CODES).toContain(c);
      expect(new LearnError(c, 'x').retryable).toBe(['TRANSLATION_OFFLINE', 'TRANSLATION_RATE_LIMITED', 'TRANSLATION_UNAVAILABLE'].includes(c));
    }
  });
  it('has the channels', () => {
    expect(Channels.translation).toEqual({ translate: 'translation:translate', cancel: 'translation:cancel' });
  });
});
