import { describe, expect, it } from 'vitest';
import { sectionHeight } from './treeLayout';

describe('sectionHeight', () => {
  it('counts the heading and the rows and not the content node of each open row', () => {
    const kinds = ['header', 'item', 'content', 'item', 'item', 'content', 'item'];
    expect(sectionHeight(kinds, 28, 36)).toBe(36 + 4 * 28);
  });
  it('is nothing for an empty section', () => {
    expect(sectionHeight([], 28, 36)).toBe(0);
  });
});
