import { describe, expect, it } from 'vitest';
import { fileStem, languageTail, subtitleFormatOf } from '../src/subtitles';

describe('subtitle names', () => {
  it('reads the format from the extension, case-insensitively', () => {
    expect(subtitleFormatOf('A.SRT')).toBe('srt');
    expect(subtitleFormatOf('b.vtt')).toBe('vtt');
    expect(subtitleFormatOf('c.txt')).toBeNull();
  });
  it('takes the stem across both separators', () => {
    expect(fileStem('/x/강의.ko.srt')).toBe('강의.ko');
    expect(fileStem('C:\\y\\a.b.vtt')).toBe('a.b');
  });
  it('splits a language tail', () => {
    expect(languageTail('강의.ko')).toEqual({ base: '강의', language: 'ko' });
    expect(languageTail('lecture.en-us')).toEqual({ base: 'lecture', language: 'en-US' });
    expect(languageTail('강의.kor').language).toBe('ko');
    expect(languageTail('강의.KO').language).toBe('ko');
  });
  it('leaves a name without a language tail whole', () => {
    expect(languageTail('강의.v2')).toEqual({ base: '강의.v2', language: null });
    expect(languageTail('강의.new')).toEqual({ base: '강의.new', language: null });
    expect(languageTail('강의')).toEqual({ base: '강의', language: null });
  });
});
