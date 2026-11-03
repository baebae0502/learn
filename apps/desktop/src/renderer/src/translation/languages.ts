import { TRANSLATION_LANGS, type TranslationFrom, type TranslationLang, type TranslationPrefs } from '@learn/domain';
import { t } from '../strings';
import type { MenuEntry } from '../ui/MenuButton';

/** The language's name, or null for a code the app has no name for (the engine may detect any language). */
export const langName = (code: string | null): string | null => (code !== null && code in t.translation.langs ? t.translation.langs[code as keyof typeof t.translation.langs] : null);

/** The original's name in the direction button and the settings: 자동 without 감지, as the mockup. */
export const fromName = (from: TranslationFrom): string => (from === 'auto' ? t.translation.autoShort : langName(from)!);
export const directionLabel = (p: Pick<TranslationPrefs, 'from' | 'to'>): string => t.translation.direction(fromName(p.from), langName(p.to)!);

export const FROM_OPTIONS: readonly TranslationFrom[] = ['auto', ...TRANSLATION_LANGS];
export const TO_OPTIONS: readonly TranslationLang[] = TRANSLATION_LANGS;

/** 번역 방향 ▾ (spec amendment 7): 원문 언어 (자동 ✓ + the seven), a separator, 대상 언어 (the seven). Ids are `from:xx` and `to:xx`. */
export function directionEntries(p: Pick<TranslationPrefs, 'from' | 'to'>): MenuEntry<string>[] {
  return [
    { header: t.translation.fromHeader, items: FROM_OPTIONS.map((v) => ({ id: `from:${v}`, label: fromName(v), checked: v === p.from, testId: `translation-from-${v}` })) },
    { separator: true },
    { header: t.translation.toHeader, items: TO_OPTIONS.map((v) => ({ id: `to:${v}`, label: langName(v)!, checked: v === p.to, testId: `translation-to-${v}` })) },
  ];
}

/** What a direction menu row says: which side it sets and the value. */
export function parseDirection(id: string): Partial<Pick<TranslationPrefs, 'from' | 'to'>> {
  const [side, value] = id.split(':') as ['from' | 'to', string];
  return side === 'from' ? { from: value as TranslationFrom } : { to: value as TranslationLang };
}
