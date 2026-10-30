import { describe, expect, it } from 'vitest';
import { SEARCH_TEXT_FIELD_MAX, clipSearchText } from '../src/library';

describe('the long search fields are cut at 4,000 characters (spec 7.1)', () => {
  it('leaves a text up to the limit as it is', () => {
    expect(SEARCH_TEXT_FIELD_MAX).toBe(4000);
    const exact = '가'.repeat(4000);
    expect(clipSearchText(exact)).toBe(exact);
    expect(clipSearchText('')).toBe('');
  });
  it('keeps the first 4,000 characters of a longer one', () => {
    const text = `${'가'.repeat(4000)}끝`;
    expect(clipSearchText(text)).toBe('가'.repeat(4000));
    expect(clipSearchText(text).length).toBe(4000);
  });
  it('never ends on half a surrogate pair', () => {
    const emoji = '😀'; // two UTF-16 units
    const text = `${'a'.repeat(3999)}${emoji}`;
    expect(text.length).toBe(4001);
    expect(clipSearchText(text)).toBe('a'.repeat(3999));
    expect(clipSearchText(`${'a'.repeat(3998)}${emoji}`)).toBe(`${'a'.repeat(3998)}${emoji}`); // the pair fits whole
  });
});
