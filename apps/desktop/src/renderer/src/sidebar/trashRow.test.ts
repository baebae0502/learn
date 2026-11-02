import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { SCOPE_KEYS, keyOfScope, scopeOfKey, visibleSpecials } from './rows';

const snap = (trashCount: number): OrganizeSnapshot => ({ collections: [], tags: [], members: {}, tagged: {}, duplicates: [], trashCount });

describe('the sidebar\'s 휴지통 (spec 4.3, design-spec 6 트리)', () => {
  it('is the last special view, with its count, only while the trash has something — also while it is viewed', () => {
    const rows = visibleSpecials({ itemCount: 3, hasRecent: true, model: buildOrganizeModel(snap(9), []), current: 'all' });
    expect(rows.at(-1)).toEqual({ kind: 'trash', count: 9 });
    const emptied = visibleSpecials({ itemCount: 3, hasRecent: true, model: buildOrganizeModel(snap(0), []), current: 'trash' });
    expect(emptied.map((r) => r.kind)).not.toContain('trash');
  });
  it('has a key of its own in the tree', () => {
    expect(SCOPE_KEYS.trash).toBe('scope:trash');
    expect(scopeOfKey('scope:trash')).toEqual({ kind: 'trash' });
    expect(keyOfScope({ kind: 'trash' })).toBe('scope:trash');
  });
});
