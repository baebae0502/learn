import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { withTagged } from './patch';

const BASE: OrganizeSnapshot = {
  collections: [], tags: [], members: {}, tagged: { a: ['i1', 'i2'], b: ['i2', 'i3'] }, duplicates: [], trashCount: 0,
};

describe('withTagged', () => {
  it('adds as a union without repeats, and a tag with no item has no key (Q-2)', () => {
    expect(withTagged(BASE, 'c', ['i1', 'i1', 'i4'], true).tagged.c).toEqual(['i1', 'i4']);
    expect(withTagged(BASE, 'a', ['i2', 'i3'], true).tagged.a).toEqual(['i1', 'i2', 'i3']);
    expect(withTagged(BASE, 'a', ['i1'], false).tagged.a).toEqual(['i2']);
    expect('a' in withTagged(BASE, 'a', ['i1', 'i2', 'i9'], false).tagged).toBe(false);
  });
  it('leaves the other tags the same arrays and the given snapshot untouched', () => {
    const frozen = JSON.stringify(BASE);
    const next = withTagged(BASE, 'a', ['i3'], true);
    expect(next.tagged.b).toBe(BASE.tagged.b);
    expect(JSON.stringify(BASE)).toBe(frozen);
  });
});
