import { describe, expect, it } from 'vitest';
import { eulReul, euroRo, iGa, waGwa } from './josa';

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

describe('을/를, 이/가 and (으)로 after a user name (collections, tags: design-spec 9)', () => {
  it('을/를: 을 after a final consonant, 를 after a vowel', () => {
    expect(eulReul('증폭')).toBe('을');
    expect(eulReul('신호')).toBe('를');
    expect(eulReul('분자생물학')).toBe('을');
    expect(eulReul('통계')).toBe('를');
    expect(eulReul(3)).toBe('을'); // 삼
    expect(eulReul('bayes')).toBe('를');
  });
  it('이/가', () => {
    expect(iGa('증폭')).toBe('이');
    expect(iGa('신호')).toBe('가');
    expect(iGa(2)).toBe('가'); // 이
  });
  it('(으)로: 으로 after a final consonant, 로 after a vowel and after ㄹ', () => {
    expect(euroRo('논문')).toBe('으로');
    expect(euroRo('학회 준비')).toBe('로');
    expect(euroRo('연구실')).toBe('로'); // 실: final ㄹ
    expect(euroRo('분자생물학')).toBe('으로');
    expect(euroRo(1)).toBe('로'); // 일: final ㄹ
    expect(euroRo(3)).toBe('으로'); // 삼
    expect(euroRo(6)).toBe('으로'); // 육
    expect(euroRo(8)).toBe('로'); // 팔: final ㄹ
    expect(euroRo('bayes')).toBe('로');
  });
  it('reads past closing quotes, brackets and punctuation to the last letter (‘논문 (모음)’ → 모음)', () => {
    expect(eulReul('논문 (모음)')).toBe('을');
    expect(waGwa('논문 (모음)')).toBe('과');
    expect(iGa('통계 (2학기)')).toBe('가');
    expect(euroRo('학회 준비!')).toBe('로');
    expect(eulReul('  ')).toBe('를');
  });
});
