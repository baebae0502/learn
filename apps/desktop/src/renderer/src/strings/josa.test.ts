import { describe, expect, it } from 'vitest';
import { waGwa } from './josa';

describe('와/과 after a quoted word (design-spec 9)', () => {
  it('takes 과 after a final consonant, 와 after a vowel, reading digits as Korean numbers', () => {
    expect(waGwa('효소 억제제')).toBe('와');
    expect(waGwa('신호')).toBe('와');
    expect(waGwa('증폭')).toBe('과');
    expect(waGwa('증폭'.normalize('NFD'))).toBe('과');
    expect(waGwa('2024')).toBe('와'); // 사
    expect(waGwa('2023')).toBe('과'); // 삼
    expect(waGwa(3)).toBe('과');
    expect(waGwa('bayes')).toBe('와');
    expect(waGwa('ㅅㅎ')).toBe('와');
  });
});
