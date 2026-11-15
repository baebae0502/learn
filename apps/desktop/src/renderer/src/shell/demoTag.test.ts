import { describe, expect, it } from 'vitest';
import { tagSpot } from './demoTag';

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, bottom: top + height });

describe('the demo overlay\'s lasting tag', () => {
  it('sits at the content area\'s top-left, under its header band, where no library table shows (the reader)', () => {
    expect(tagSpot(box(240, 52, 880, 848), 28, null)).toEqual({ left: 256, top: 92 });
  });
  it('sits over the library table\'s empty area, under its last row — never on the header row\'s column names', () => {
    expect(tagSpot(box(240, 52, 880, 848), 28, box(248, 352, 864, 28))).toEqual({ left: 256, top: 396 });
  });
  it('stays inside the content area when the rows fill it', () => {
    expect(tagSpot(box(240, 52, 880, 848), 28, box(248, 880, 864, 28))).toEqual({ left: 256, top: 852 });
  });
  it('has no spot without a content area shown (the window\'s own corner then)', () => {
    expect(tagSpot(null, 28, null)).toBeNull();
    expect(tagSpot(box(0, 0, 0, 0), 28, null)).toBeNull();
  });
});
