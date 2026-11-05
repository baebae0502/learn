import { describe, expect, it } from 'vitest';
import { spokenResult } from './TranslationStatus';

describe('what the one live region says', () => {
  it('says the translation on one line, the same-language note, a failure and a refusal', () => {
    expect(spokenResult({ kind: 'done', text: '첫째.\n둘째.', detectedFrom: 'en', cached: false, sameLanguage: false }, '한국어')).toBe('첫째. 둘째.');
    expect(spokenResult({ kind: 'done', text: 'x', detectedFrom: 'ko', cached: false, sameLanguage: true }, '한국어')).toBe('이미 한국어입니다');
    expect(spokenResult({ kind: 'error', code: 'TRANSLATION_OFFLINE', message: '오프라인입니다' }, '한국어')).toBe('오프라인입니다');
    expect(spokenResult({ kind: 'pending' }, '한국어')).not.toBe('');
    expect(spokenResult({ kind: 'tooLong' }, '한국어')).not.toBe('');
  });
  it('is silent while the user is only asked or nothing is shown', () => {
    for (const kind of ['idle', 'consent', 'off'] as const) expect(spokenResult({ kind }, '한국어'), kind).toBe('');
  });
});
