import { describe, expect, it } from 'vitest';
import { organizeWireBytes, packOrganize, unpackOrganize, type OrganizeSnapshot } from '../src';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

describe('OrganizeWire', () => {
  it('round-trips, with empty maps and each item id once', () => {
    const empty: OrganizeSnapshot = { collections: [], tags: [], members: {}, tagged: {}, duplicates: [], trashCount: 0 };
    expect(unpackOrganize(packOrganize(empty))).toEqual(empty);
    const s: OrganizeSnapshot = {
      collections: [{ id: 'c1', name: 'A', parentId: null, createdAt: 't' }],
      tags: [{ id: 't1', name: 'x', color: null, position: null }],
      members: { c1: [id(3), id(1), id(2)] },
      tagged: { t1: [id(2), id(3)] },
      duplicates: [[id(1), id(2)]],
      trashCount: 4,
    };
    const w = packOrganize(s);
    expect(w.itemIds).toEqual([id(3), id(1), id(2)]);
    expect(w.members.c1).toBeInstanceOf(Uint32Array);
    expect(unpackOrganize(w)).toEqual(s);
  });

  it('weighs under 800,000 bytes and under half of the JSON for 10,000 items, 200 x 150 and 50 x 400', () => {
    const items = Array.from({ length: 10000 }, (_, i) => id(i));
    const members: Record<string, string[]> = {};
    for (let c = 0; c < 200; c++) members[`c${c}`] = items.slice(c * 50, c * 50 + 150);
    const tagged: Record<string, string[]> = {};
    for (let t = 0; t < 50; t++) tagged[`t${t}`] = items.slice(t * 100, t * 100 + 400);
    const s: OrganizeSnapshot = { collections: [], tags: [], members, tagged, duplicates: [], trashCount: 0 };
    const bytes = organizeWireBytes(packOrganize(s));
    expect(bytes).toBeLessThanOrEqual(800_000);
    expect(bytes).toBeLessThan(JSON.stringify(s).length / 2);
  });
});
