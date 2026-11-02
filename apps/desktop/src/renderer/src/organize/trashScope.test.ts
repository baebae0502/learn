import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from './model';
import { resolveScope, restorableScope, scopeItems, scopeLabel } from './scope';
import { item } from './testing';

const snap = (trashCount: number): OrganizeSnapshot => ({ collections: [], tags: [], members: {}, tagged: {}, duplicates: [], trashCount });

describe('the trash view (P-7, spec 4.3)', () => {
  it('shows the trash list as it is, is named 휴지통, and is shown only while the trash has something', () => {
    const full = buildOrganizeModel(snap(2), []);
    const empty = buildOrganizeModel(snap(0), []);
    const list = [item('t1')];
    expect(scopeItems(full, list, { kind: 'trash' }, 0)).toBe(list);
    expect(scopeLabel(full, { kind: 'trash' })).toBe('휴지통');
    expect(resolveScope(full, { kind: 'trash' })).toEqual({ kind: 'trash' });
    expect(resolveScope(empty, { kind: 'trash' })).toEqual({ kind: 'all' });
    expect(resolveScope(undefined, { kind: 'trash' })).toEqual({ kind: 'all' });
    expect(restorableScope({ kind: 'trash' }, full, [], 0)).toEqual({ kind: 'trash' });
    expect(restorableScope({ kind: 'trash' }, empty, [], 0)).toEqual({ kind: 'all' });
    expect(full.trashCount).toBe(2);
  });
});
