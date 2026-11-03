import { describe, expect, it, vi } from 'vitest';
import { dispatchFind, selectionQuery } from './findControl';

const selecting = (text: string | null) => (text === null ? null : ({ toString: () => text } as Selection));

describe('selectionQuery', () => {
  it('is empty without a selection', () => {
    expect(selectionQuery(null)).toBe('');
    expect(selectionQuery(selecting('  \n '))).toBe('');
  });
  it('folds whitespace and trims', () => {
    expect(selectionQuery(selecting('  self-\n attention \t mechanism '))).toBe('self- attention mechanism');
  });
  it('keeps at most 100 characters, without a trailing space', () => {
    const long = `${'a'.repeat(99)} bbbb`;
    expect(selectionQuery(selecting(long))).toBe('a'.repeat(99));
    expect(selectionQuery(selecting('가'.repeat(150)))).toHaveLength(100);
  });
});

describe('dispatchFind', () => {
  it('asks in NFC, ignoring case and diacritics, marking every match', () => {
    const dispatch = vi.fn();
    dispatchFind({ dispatch } as never, '메커니즘'.normalize('NFD'), 'again', true);
    expect(dispatch).toHaveBeenCalledWith('find', {
      source: null, type: 'again', query: '메커니즘'.normalize('NFC'), caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: true, matchDiacritics: false,
    });
  });
});
