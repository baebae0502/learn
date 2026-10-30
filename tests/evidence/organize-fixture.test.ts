import { describe, expect, it } from 'vitest';
import { SPEC_12, buildOrganizeFixture, type OrganizeFixture } from './organize-fixture';

const N = 10_001; // the 10,000 seeded items and the imported PDF they copy

/** What the input says, computed the plain way: a collection's items with every descendant collection's, by walking parents. */
function subtreeItems(fx: OrganizeFixture, root: number): Set<number> {
  const { collections, memberships } = fx.input;
  const inside = (c: number): boolean => {
    for (let x: number | null = c; x !== null; x = collections[x]!.parent) if (x === root) return true;
    return false;
  };
  return new Set(memberships.filter(([c]) => inside(c)).map(([, i]) => i));
}
const tagItems = (fx: OrganizeFixture, tag: number) => new Set(fx.input.assignments.filter(([t]) => t === tag).map(([, i]) => i));
const depthOf = (fx: OrganizeFixture, c: number): number => {
  const p = fx.input.collections[c]!.parent;
  return p === null ? 1 : 1 + depthOf(fx, p);
};

describe('the organise fixture is the one spec 12 describes', () => {
  const fx = buildOrganizeFixture(N);
  const { input } = fx;

  it('has the counts of spec 12', () => {
    expect(input.collections).toHaveLength(200);
    expect(input.tags).toHaveLength(50);
    expect(input.memberships).toHaveLength(30_000);
    expect(input.assignments).toHaveLength(20_000);
    expect(input.duplicates).toHaveLength(50);
  });
  it('nests collections at most four deep, reaches four, and puts every parent before its child', () => {
    const depths = input.collections.map((_, c) => depthOf(fx, c));
    expect(Math.max(...depths)).toBe(4);
    expect(depths.filter((d) => d === 1)).toHaveLength(12);
    input.collections.forEach((c, i) => expect(c.parent === null || c.parent < i).toBe(true));
    expect(new Set(input.collections.map((c) => c.name)).size).toBe(200);
  });
  it('gives 8 tags a colour and a position 1–8 in the colour order, and the others none', () => {
    expect(input.tags.slice(0, 8).map((t) => t.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(input.tags.slice(0, 8).map((t) => t.color)).size).toBe(8);
    expect(input.tags.slice(8).every((t) => t.color === null && t.position === null)).toBe(true);
    expect(new Set(input.tags.map((t) => t.name.toLowerCase())).size).toBe(50);
  });
  it('has no repeated pair, and every index points at an item, a collection or a tag', () => {
    const pairs = (xs: Array<[number, number]>) => new Set(xs.map(([a, b]) => a * N + b));
    expect(pairs(input.memberships).size).toBe(30_000);
    expect(pairs(input.assignments).size).toBe(20_000);
    for (const [c, i] of input.memberships) expect(c < 200 && i < N).toBe(true);
    for (const [t, i] of input.assignments) expect(t < 50 && i < N).toBe(true);
  });
  it('keeps the first 50 items free of the tag at position 1 (the one-item key press starts from "not tagged")', () => {
    expect(input.assignments.some(([t, i]) => t === 0 && i < 50)).toBe(false);
  });
  it('makes 50 disjoint duplicate groups of 2–4 items', () => {
    const all = input.duplicates!.flat();
    expect(new Set(all).size).toBe(all.length);
    for (const g of input.duplicates!) expect(g.length >= 2 && g.length <= 4).toBe(true);
    expect(fx.facts.duplicateItems).toBe(all.length);
  });
  it('is the same every time, and another seed is another fixture', () => {
    expect(buildOrganizeFixture(N)).toEqual(fx);
    expect(buildOrganizeFixture(N, SPEC_12, 12).input.memberships).not.toEqual(input.memberships);
  });
});

describe('the facts the timings are checked against', () => {
  const fx = buildOrganizeFixture(N);

  it('lists the views to switch between with the counts and first items recomputed from the input', () => {
    const filed = new Set(fx.input.memberships.map(([, i]) => i));
    const dupItems = new Set(fx.input.duplicates!.flat());
    const byLabel = new Map(fx.facts.scopes.map((s) => [s.label, s]));
    expect(byLabel.get('all')).toMatchObject({ count: N, first: 0 });
    expect(byLabel.get('unfiled')).toMatchObject({ count: N - filed.size, first: [...Array(N).keys()].find((i) => !filed.has(i)) });
    expect(byLabel.get('duplicates')).toMatchObject({ count: dupItems.size, first: Math.min(...dupItems) });
    const roots = fx.facts.scopes.filter((s) => s.kind === 'collection');
    expect(roots).toHaveLength(3);
    for (const r of roots) {
      const items = subtreeItems(fx, r.collection!);
      expect(r.count).toBe(items.size);
      expect(r.first).toBe(Math.min(...items));
      expect(fx.input.collections[r.collection!]!.parent).toBeNull();
    }
    const sizes = roots.map((r) => r.count);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a)); // the three largest, largest first
  });
  it('has views of different sizes, so a switch always changes the count the timing waits for', () => {
    const counts = fx.facts.scopes.map((s) => s.count);
    expect(new Set(counts).size).toBe(counts.length);
    expect(counts.every((c) => c > 0)).toBe(true);
  });
  it('gives each tag its count and first item, and a count that is not the whole library', () => {
    for (let t = 0; t < 5; t++) {
      const items = tagItems(fx, t);
      expect(fx.facts.tagCount[t]).toBe(items.size);
      expect(fx.facts.tagFirst[t]).toBe(Math.min(...items));
      expect(items.size).toBeGreaterThan(100);
      expect(items.size).toBeLessThan(N);
    }
  });
  it('names the first two tags and the first two top-level collections so that a second typed character narrows', () => {
    const [a, b] = fx.facts.tagNames;
    expect([...a!][0]).toBe([...b!][0]);
    expect([...a!][1]).not.toBe([...b!][1]);
    const [c, d] = fx.facts.collectionNames;
    expect([...c!][0]).toBe([...d!][0]);
    expect([...c!][1]).not.toBe([...d!][1]);
  });
});

describe('a small library gets a small fixture from the same code', () => {
  it('scales by the spec', () => {
    const spec = { ...SPEC_12, collections: 20, roots: 3, tags: 12, memberships: 400, assignments: 200, duplicateGroups: 5 };
    const fx = buildOrganizeFixture(300, spec);
    expect(fx.input.collections).toHaveLength(20);
    expect(fx.input.memberships).toHaveLength(400);
    expect(fx.input.assignments).toHaveLength(200);
    expect(fx.input.duplicates).toHaveLength(5);
  });
  it('refuses a spec its library cannot hold, instead of looping', () => {
    expect(() => buildOrganizeFixture(10, { ...SPEC_12, collections: 5, roots: 2, memberships: 100 })).toThrow(/memberships/);
  });
});
