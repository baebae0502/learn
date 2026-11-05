import { describe, expect, it } from 'vitest';
import { parsePage } from './parsePage';

describe('the page field', () => {
  it('takes digits within the document', () => {
    expect(parsePage('1', 100)).toBe(1);
    expect(parsePage('100', 100)).toBe(100);
    expect(parsePage('007', 100)).toBe(7);
  });
  it('refuses anything that is not a page', () => {
    for (const text of ['1e1', '0x10', ' 5', '5 ', '5.0', '-3', '', 'abc', '0', '101', '999']) expect(parsePage(text, 100), text).toBeNull();
    expect(parsePage(null, 100)).toBeNull();
  });
});
