import { describe, expect, it } from 'vitest';
import { clipAttached, lineStartOf } from './selectionAnchor';

describe('the passage a question carries (spec 8.4, J46)', () => {
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

describe('where the passage\'s first line begins: its page mark\'s bar stands left of that', () => {
  /** A text item as the text layer has it: whether a line ends after it, its baseline's start (x, y) and its height, in page space. */
  const item = (x: number, y: number, hasEOL = true, h = 10) => ({ hasEOL, at: { x, y, h } });
  /** An item drawn at an angle: no upright line to stand by. */
  const turned = (hasEOL = false) => ({ hasEOL, at: null });

  it('is the start of the line the passage starts in, not of the column beside it', () => {
    // A title, then a line of the left column and one of the right column on the same baseline (two columns, read in turn).
    const items = [item(56, 806, true, 14), item(56, 700), item(304, 700)];
    expect(lineStartOf(items, 2)).toBe(304);
    expect(lineStartOf(items, 1)).toBe(56);
  });

  it('goes back over the items of the same line before the passage\'s', () => {
    const items = [item(56, 806), item(56, 700, false), item(120, 700, false), item(200, 700)];
    expect(lineStartOf(items, 3)).toBe(56);
    expect(lineStartOf(items, 0)).toBe(56);
  });

  it('leaves out an item of the line that is not on its baseline (a raised or a turned one)', () => {
    const items = [item(56, 806), item(40, 712, false), turned(), item(80, 700)];
    expect(lineStartOf(items, 3)).toBe(80);
  });

  it('is null for an item that is not upright', () => {
    expect(lineStartOf([turned(true)], 0)).toBeNull();
  });
});
