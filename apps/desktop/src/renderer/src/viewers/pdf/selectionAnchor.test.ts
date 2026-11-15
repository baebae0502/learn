import { describe, expect, it } from 'vitest';
import { clipAttached, foldAttached, pageLines } from './selectionAnchor';

describe('the passage a question carries (spec 8.4)', () => {
  it('keeps the first 4,000 characters of a longer one and says it was cut', () => {
    expect(clipAttached('a'.repeat(4001))).toEqual({ text: 'a'.repeat(4000), long: true });
  });
  it('leaves a passage of 4,000 characters or fewer as it is', () => {
    expect(clipAttached('a'.repeat(4000))).toEqual({ text: 'a'.repeat(4000), long: false });
    expect(clipAttached('We propose a new simple network architecture.')).toEqual({ text: 'We propose a new simple network architecture.', long: false });
  });
  it('never ends inside a surrogate pair', () => {
    expect(clipAttached(`${'a'.repeat(3999)}😀b`)).toEqual({ text: 'a'.repeat(3999), long: true });
  });
});

describe('the passage\'s words as they go: its line ends folded once, for the chip, the stored quote and the agent alike', () => {
  it('folds each run of white space to one space, and joins a line that ends with a hyphen to the next with none', () => {
    expect(foldAttached('The dominant sequence transduc-\ntion models are based\non complex recurrent\n').text).toBe('The dominant sequence transduc-tion models are based on complex recurrent');
    // A compound broken at its hyphen keeps the hyphen; a dash with a space before it is no hyphen.
    expect(foldAttached('a multi-head self-\nattention mechanism').text).toBe('a multi-head self-attention mechanism');
    expect(foldAttached('one -\ntwo').text).toBe('one - two');
  });
  it('says where in the page text each folded character ends, so a cut passage\'s mark ends where its words do', () => {
    const { text, ends } = foldAttached(' ab-\ncd  e');
    expect(text).toBe('ab-cd e');
    expect(ends).toEqual([2, 3, 4, 6, 7, 9, 10]);
  });
  it('counts the 4,000 characters on the folded words', () => {
    const raw = `${'word '.repeat(799)}tail-\nend`;
    const folded = foldAttached(raw).text;
    expect(folded.length).toBe(4003);
    expect(clipAttached(folded)).toEqual({ text: folded.slice(0, 4000), long: true });
  });
});

describe('the page\'s lines, in reading order, as the page mark\'s runs read them', () => {
  /** A text item: whether a line ends after it, its baseline's start (x, y), its height and length, the way it runs. */
  const item = (x: number, y: number, hasEOL = true, w = 100, turn: 0 | 90 = 0, h = 10) => ({ hasEOL, at: { x, y, h, w, turn } });
  /** An item drawn at an angle: no line to stand by. */
  const slanted = (hasEOL = false) => ({ hasEOL, at: null });

  it('one line per line end: where its items begin and end along the text, its first baseline, its tallest item', () => {
    const items = [item(56, 806, true, 150, 0, 14), item(56, 700, false, 60), item(120, 700, false, 50), slanted(), item(180, 700, true, 100)];
    const { lines, lineOfItem } = pageLines(items, 0);
    expect(lines).toEqual([{ start: 56, end: 206, base: 806, h: 14 }, { start: 56, end: 280, base: 700, h: 10 }]);
    expect(lineOfItem).toEqual([0, 1, 1, 1, 1]);
  });

  it('an empty item standing where the next text begins (the footnote) only ends the line it follows', () => {
    // Column 2's last line, then pdf.js's empty item at the footnote's place, then the footnote.
    const items = [item(304, 214, false, 226), item(56, 60, true, 0, 0, 8), item(56, 60, false, 78, 0, 8)];
    const { lines, lineOfItem } = pageLines(items, 0);
    expect(lines).toEqual([{ start: 304, end: 530, base: 214, h: 10 }, { start: 56, end: 134, base: 60, h: 8 }]);
    expect(lineOfItem).toEqual([0, 0, 1]);
  });

  it('two columns read in turn are two lines on one baseline', () => {
    const { lines } = pageLines([item(56, 700, true, 235), item(304, 700, true, 235)], 0);
    expect(lines.map((l) => l.start)).toEqual([56, 304]);
  });

  it('reads text running up the page in its own frame, and leaves out the items that run another way', () => {
    const { lines, lineOfItem } = pageLines([item(100, 50, false, 200, 90), item(40, 700, true, 50, 0)], 90);
    expect(lines).toEqual([{ start: 50, end: 250, base: -100, h: 10 }]);
    expect(lineOfItem).toEqual([0, 0]);
    expect(pageLines([item(40, 700, true, 50, 0)], 90).lineOfItem).toEqual([-1]);
  });
});
