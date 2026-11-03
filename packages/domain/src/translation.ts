import { z } from 'zod';

/** The languages the reader offers (spec 6.4): the target list, and the source list beside 'auto'. */
export const TRANSLATION_LANGS = ['ko', 'en', 'ja', 'zh-CN', 'de', 'fr', 'es'] as const;
export type TranslationLang = (typeof TRANSLATION_LANGS)[number];
export type TranslationFrom = 'auto' | TranslationLang;

/** A selection longer than this is refused; the service sends it in pieces of at most CHUNK_CHARS. */
export const TRANSLATION_MAX_CHARS = 5000;
export const TRANSLATION_CHUNK_CHARS = 4500;
export const TRANSLATION_CACHE_MAX = 2000;

export const translationFromSchema = z.enum(['auto', ...TRANSLATION_LANGS]);
export const translationToSchema = z.enum(TRANSLATION_LANGS);

/** `enabled` null = the user has not decided yet: nothing is sent until it is true. */
export const translationPrefsSchema = z
  .object({ enabled: z.boolean().nullable(), autoOnSelect: z.boolean(), from: translationFromSchema, to: translationToSchema })
  .strict();
export type TranslationPrefs = z.infer<typeof translationPrefsSchema>;
export const DEFAULT_TRANSLATION_PREFS = { enabled: null, autoOnSelect: true, from: 'auto', to: 'ko' } as const satisfies TranslationPrefs;

export interface TranslationResult {
  text: string;
  detectedFrom: string | null;
  engine: string;
  cached: boolean;
  /** The text is already in the target language: the panel says so instead of showing a copy. */
  sameLanguage: boolean;
}
