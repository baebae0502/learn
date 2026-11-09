import { describe, expect, it } from 'vitest';
import { MARK_END, MARK_START } from '@learn/domain';
import { bodyStateLine, snippetParts } from './bodyText';

describe('the body index state line (spec 5.8, 11: the file section\'s 본문 검색 and the 본문 일치 section)', () => {
  it('says each state that is not done, in the spec\'s words', () => {
    expect(bodyStateLine({ state: 'pending' })).toBe('본문을 색인하는 중입니다.');
    expect(bodyStateLine({ state: 'empty', pages: 2 })).toBe('글자를 찾지 못했습니다. 스캔한 PDF일 수 있습니다.');
    expect(bodyStateLine({ state: 'failed', reason: 'locked' })).toBe('암호로 보호된 PDF라 본문을 색인하지 않았습니다.');
    expect(bodyStateLine({ state: 'failed', reason: 'damaged' })).toBe('파일 내용이 손상되어 본문을 색인하지 못했습니다.');
    expect(bodyStateLine({ state: 'failed', reason: 'too-large' })).toBe('파일이 너무 커서 본문을 색인하지 않았습니다.');
    expect(bodyStateLine({ state: 'failed', reason: 'gave-up' })).toBe('본문을 색인하지 못했습니다. 파일이 복잡하거나 손상되었을 수 있습니다.');
  });
  it('is quiet when the index is done, and says how far a cut one went', () => {
    expect(bodyStateLine({ state: 'done', pages: 30, truncated: false })).toBeNull();
    expect(bodyStateLine({ state: 'done', pages: 5000, truncated: true })).toBe('앞 5,000쪽까지 색인했습니다.');
    expect(bodyStateLine({ state: 'done', pages: 812, truncated: true })).toBe('앞 812쪽까지 색인했습니다.');
  });
});

describe('a snippet\'s marked parts (U+E000 … U+E001 → <mark>, never HTML)', () => {
  it('splits the text at the marks', () => {
    expect(snippetParts('abc')).toEqual([
      { text: 'a', mark: false },
      { text: 'b', mark: true },
      { text: 'c', mark: false },
    ]);
    expect(MARK_START + MARK_END).toBe('');
  });
  it('keeps several marks, a mark at either end, and drops an empty part', () => {
    expect(snippetParts('형광 단백질과 형광')).toEqual([
      { text: '형광', mark: true },
      { text: ' 단백질과 ', mark: false },
      { text: '형광', mark: true },
    ]);
    expect(snippetParts('…xy…')).toEqual([{ text: '…xy…', mark: false }]);
    expect(snippetParts('plain')).toEqual([{ text: 'plain', mark: false }]);
    expect(snippetParts('')).toEqual([]);
  });
  it('shows the text alone, with no mark, when the marks do not pair up', () => {
    expect(snippetParts('ab')).toEqual([{ text: 'ab', mark: false }]);
    expect(snippetParts('abc')).toEqual([{ text: 'abc', mark: false }]);
    expect(snippetParts('ab')).toEqual([{ text: 'ab', mark: false }]);
  });
  it('takes markup as text: a snippet is never HTML', () => {
    expect(snippetParts('<b><i>')).toEqual([
      { text: '<b>', mark: false },
      { text: '<i>', mark: true },
    ]);
  });
});
