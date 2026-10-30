import { describe, expect, it } from 'vitest';
import { organizeSteps, searchSteps } from './search-steps';

const items = [
  { title: '세포 신호 전달 개요', creators: ['김민지', 'Lee'] },
  { title: 'Linear Algebra — Eigenvalues', creators: [] },
  { title: '광합성 명반응과 암반응', creators: [] },
  { title: 'Intro to Bayesian Inference', creators: [] },
];

describe("search inputs taken from the rows the test seeds (Task 3's seedRows)", () => {
  it('types two Korean title runs, their initials, two Latin words and a creator, one character at a time', () => {
    expect(searchSteps(items)).toEqual([
      { group: 'ko', chars: ['세', '포'] },
      { group: 'initials', chars: ['ㅅ', 'ㅍ'] },
      { group: 'ko', chars: ['광', '합', '성'] },
      { group: 'en', chars: ['L', 'i', 'n', 'e'] },
      { group: 'en', chars: ['A', 'l', 'g', 'e'] },
      { group: 'creator', chars: ['김', '민'] },
    ]);
  });
  it('leaves out what the library does not have', () => {
    expect(searchSteps([{ title: 'v2 · 01', creators: ['x'] }])).toEqual([]);
  });
});


describe('the typed steps that reach the organise fixture', () => {
  it('types the first two characters of a tag name and of a collection name, one at a time', () => {
    expect(organizeSteps({ tag: '복습필요', collection: '분자생물학' })).toEqual({
      tag: [{ group: 'tag', chars: ['복', '습'] }],
      collection: [{ group: 'collection', chars: ['분', '자'] }],
    });
  });
  it('leaves out spaces, so a name with one still types two characters', () => {
    expect(organizeSteps({ tag: '읽는 중', collection: 'A B' }).tag[0]!.chars).toEqual(['읽', '는']);
    expect(organizeSteps({ tag: '읽는 중', collection: 'A B' }).collection[0]!.chars).toEqual(['A', 'B']);
  });
});
