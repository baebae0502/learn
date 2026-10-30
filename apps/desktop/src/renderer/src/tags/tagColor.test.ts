import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TAG_COLORS } from '@learn/domain';
import { tagColorId, tagColorVar } from './tagColor';

const tokens = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../design/tokens.css'), 'utf8');

describe('tag colours (design-spec 4)', () => {
  it('slot N is the var of token --tag-N', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(tagColorVar)).toEqual(['var(--tag-1)', 'var(--tag-2)', 'var(--tag-3)', 'var(--tag-4)', 'var(--tag-5)', 'var(--tag-6)', 'var(--tag-7)', 'var(--tag-8)']);
  });
  it('colour N is the domain\'s colour N, and the token has its value (the same in both themes)', () => {
    TAG_COLORS.forEach((c, i) => {
      expect(tagColorId(i + 1)).toBe(c.id);
      expect(tokens, `--tag-${i + 1}`).toMatch(new RegExp(`--tag-${i + 1}:\\s*${c.hex};`));
    });
  });
  it('refuses a slot there is no colour for', () => {
    expect(() => tagColorId(0)).toThrow(RangeError);
    expect(() => tagColorId(9)).toThrow(RangeError);
  });
});
