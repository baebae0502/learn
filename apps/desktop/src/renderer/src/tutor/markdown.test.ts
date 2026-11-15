import { describe, expect, it } from 'vitest';
import { parseAnswer, splitStable, streamingText, type AnswerBlock, type Inline } from './markdown';

const p = (...inline: Inline[]): AnswerBlock => ({ kind: 'p', inline });
const text = (t: string): Inline => ({ kind: 'text', text: t });

describe('the answer\'s small Markdown', () => {
  it('keeps to the subset: a heading is a bold paragraph, cite tokens are chips, code keeps its tokens as text', () => {
    expect(parseAnswer('# 제목\n어텐션은 **중요** _하다_ `x` [[p42]].\n\n```\n[[p1]] <b>\n```')).toEqual([
      p({ kind: 'strong', children: [text('제목')] }),
      p(text('어텐션은 '), { kind: 'strong', children: [text('중요')] }, text(' '), { kind: 'em', children: [text('하다')] }, text(' '), { kind: 'code', text: 'x' }, text(' '), { kind: 'cite', pageIndex: 41 }, text('.')),
      { kind: 'code', text: '[[p1]] <b>' },
    ]);
  });
  it('leaves HTML, links, images and tables as text', () => {
    expect(parseAnswer('<img src=x> [t](http://x) ![a](u) | a | b |')).toEqual([p(text('<img src=x> [t](http://x) ![a](u) | a | b |'))]);
  });
  it('two list levels and a quote', () => {
    const [list, quote] = parseAnswer('- one\n  - two\n- three\n\n> q');
    expect(list).toMatchObject({ kind: 'list', ordered: false, items: [{ inline: [text('one')], sub: { kind: 'list', items: [{ inline: [text('two')] }] } }, { inline: [text('three')] }] });
    expect(quote).toEqual({ kind: 'quote', blocks: [p(text('q'))] });
  });
  it('splits the finished blocks from the one still streaming', () => {
    expect(splitStable('a\n\nb\n\nc')).toEqual({ stable: 'a\n\nb\n\n', tail: 'c' });
    expect(splitStable('```\nx\n\ny')).toEqual({ stable: '', tail: '```\nx\n\ny' }); // an open code fence is one block
  });

  it('breaks a line where the answer does, and a blank line ends the paragraph', () => {
    expect(parseAnswer('첫 줄\n둘째 줄\n\n다음 문단')).toEqual([p(text('첫 줄'), { kind: 'break' }, text('둘째 줄')), p(text('다음 문단'))]);
  });
  it('an ordered list stays one list across the blank lines between its items, and a third level stays in the second', () => {
    const [list, after] = parseAnswer('1. 하나\n\n2. 둘\n   1. 둘의 하나\n      - 셋째 단계\n3. 셋\n\n끝');
    expect(list).toEqual({
      kind: 'list', ordered: true, items: [
        { inline: [text('하나')], sub: null },
        { inline: [text('둘')], sub: { kind: 'list', ordered: true, items: [{ inline: [text('둘의 하나')], sub: null }, { inline: [text('셋째 단계')], sub: null }] } },
        { inline: [text('셋')], sub: null },
      ],
    });
    expect(after).toEqual(p(text('끝')));
  });
  it('a date at the start of a line inside a paragraph is not a list, and an underscore inside a word is not emphasis', () => {
    expect(parseAnswer('발표일은\n2026. 10. 12.입니다')).toEqual([p(text('발표일은'), { kind: 'break' }, text('2026. 10. 12.입니다'))]);
    expect(parseAnswer('snake_case_name과 *기울임*')).toEqual([p(text('snake_case_name과 '), { kind: 'em', children: [text('기울임')] })]);
  });
  it('a marker without its closing one is text, and emphasis may hold a cite', () => {
    expect(parseAnswer('**열린 채 `코드')).toEqual([p(text('**열린 채 `코드'))]);
    expect(parseAnswer('**근거 [[p3]]**')).toEqual([p({ kind: 'strong', children: [text('근거 '), { kind: 'cite', pageIndex: 2 }] })]);
  });
  it('a fence keeps its lines, drops its language name, and runs to the end while it is open', () => {
    expect(parseAnswer('```ts\nconst a = 1;\n\nconst b = 2;\n```')).toEqual([{ kind: 'code', text: 'const a = 1;\n\nconst b = 2;' }]);
    expect(parseAnswer('앞\n```\n열린 코드')).toEqual([p(text('앞')), { kind: 'code', text: '열린 코드' }]);
  });
  it('a numbered list interrupted by a paragraph goes on at its own number', () => {
    const [first, para, second] = parseAnswer('1. 첫째\n\n중간 설명\n\n2. 둘째\n3. 셋째');
    expect(first).toEqual({ kind: 'list', ordered: true, items: [{ inline: [text('첫째')], sub: null }] });
    expect(para).toEqual(p(text('중간 설명')));
    expect(second).toEqual({ kind: 'list', ordered: true, start: 2, items: [{ inline: [text('둘째')], sub: null }, { inline: [text('셋째')], sub: null }] });
  });
  it('lines indented under an item after a blank line stay in that item: a paragraph, a code block, a quote', () => {
    expect(parseAnswer('1. 첫째\n\n   이어지는 설명\n\n2. 둘째')).toEqual([
      { kind: 'list', ordered: true, items: [{ inline: [text('첫째')], sub: null, blocks: [p(text('이어지는 설명'))] }, { inline: [text('둘째')], sub: null }] },
    ]);
    expect(parseAnswer('1. 설치\n   ```\n   npm i\n   ```\n2. 실행\n   > 끝나면 닫습니다')).toEqual([
      {
        kind: 'list', ordered: true, items: [
          { inline: [text('설치')], sub: null, blocks: [{ kind: 'code', text: 'npm i' }] },
          { inline: [text('실행')], sub: null, blocks: [{ kind: 'quote', blocks: [p(text('끝나면 닫습니다'))] }] },
        ],
      },
    ]);
    // A line that is not indented after a blank line ends the item, and the list.
    expect(parseAnswer('- 하나\n\n밖의 문단')).toEqual([{ kind: 'list', ordered: false, items: [{ inline: [text('하나')], sub: null }] }, p(text('밖의 문단'))]);
  });
  it('reads Windows line ends as line ends, in the split as in the parse', () => {
    expect(splitStable('x\r\n\r\n- a\r\n\r\n- b')).toEqual({ stable: 'x\n\n', tail: '- a\n\n- b' });
    expect(parseAnswer('- a\r\n\r\n- b')).toEqual(parseAnswer('- a\n\n- b'));
  });
  it('splits a streaming answer before a list only where the list begins, never between its items', () => {
    expect(splitStable('머리\n\n1. 하나\n\n2. 둘')).toEqual({ stable: '머리\n\n', tail: '1. 하나\n\n2. 둘' });
    expect(splitStable('한 문단')).toEqual({ stable: '', tail: '한 문단' });
    expect(splitStable('1. 하나\n\n   이어서\n\n2. 둘')).toEqual({ stable: '', tail: '1. 하나\n\n   이어서\n\n2. 둘' }); // an item's own paragraph
    // What is stable parses to the same blocks it has in the whole answer.
    for (const whole of ['a\n\n- x\n- y\n\nb **c**\n\n```\nz\n```\n\nd', '1. 하나\n\n중간\n\n2. 둘\n\n   이어서\n\n끝']) {
      const { stable, tail } = splitStable(whole);
      expect([...parseAnswer(stable), ...parseAnswer(tail)]).toEqual(parseAnswer(whole));
    }
  });

  it('while an answer streams, a cite token cut short at its end is held back until it closes: no "[" is drawn, a closed one is a chip', () => {
    for (const cut of ['…라고 설명합니다 [[', '…라고 설명합니다 [[p', '…라고 설명합니다 [[p2', '…라고 설명합니다 [[p2]', '…라고 설명합니다 [']) {
      expect(parseAnswer(streamingText(cut)), cut).toEqual([p(text('…라고 설명합니다'))]);
    }
    expect(parseAnswer(streamingText('…라고 설명합니다 [[p2]]'))).toEqual([p(text('…라고 설명합니다 '), { kind: 'cite', pageIndex: 1 })]);
    // Only at the end: a token that closed, or "[" text earlier in the answer, is drawn as it was.
    expect(streamingText('[1] 참고 [[p2]] 그리고')).toBe('[1] 참고 [[p2]] 그리고');
    // Not a cite token at all: drawn at once.
    expect(streamingText('배열 a[0')).toBe('배열 a[0');
    expect(streamingText('[[x')).toBe('[[x');
  });
});
