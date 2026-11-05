import { describe, expect, it } from 'vitest';
import { TRANSLATION_MAX_CHARS, isTranslationTooLong, prepareText, preparedLength } from '../src';

describe('the length rule of a translation (final review m-3): the prepared text, in main and in the reader alike', () => {
  it('measures the text as it is sent: NFC, line-end hyphens joined, runs of blanks as one', () => {
    expect(preparedLength('  a  b\n c ')).toBe(5);
    expect(preparedLength('state-of-the-\nart')).toBe('state-of-theart'.length);
    expect(preparedLength('')).toBe(0);
    expect(prepareText('state-of-the-\nart')).toBe('state-of-theart');
  });
  it('counts NFD Hangul by its syllables: just over 5,000 code units raw, within the limit once prepared', () => {
    const nfd = '가'.repeat(2500).normalize('NFD') + '나'.repeat(1000).normalize('NFD');
    expect(nfd.length).toBeGreaterThan(TRANSLATION_MAX_CHARS);
    expect(preparedLength(nfd)).toBe(3500);
    expect(isTranslationTooLong(nfd)).toBe(false);
  });
  it('is too long past 5,000 prepared characters, not at 5,000', () => {
    expect(isTranslationTooLong('a'.repeat(TRANSLATION_MAX_CHARS))).toBe(false);
    expect(isTranslationTooLong('a'.repeat(TRANSLATION_MAX_CHARS + 1))).toBe(true);
    expect(isTranslationTooLong(`${'a'.repeat(TRANSLATION_MAX_CHARS)}   `)).toBe(false);
  });
});
