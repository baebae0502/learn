// The organise fixture of spec 12 over a seeded library: collections, tags, memberships, assignments and duplicate groups,
// drawn from a seeded generator so a run measures the same library every time. Pure (the unit test checks it against
// what its own input says); seedOrganizeFixture hands it to main's E2E hook and checks the snapshot main then sends.
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { TAG_COLORS, type TagColorId } from '../../packages/domain/src/tag-colors';

export interface OrganizeSeedInput {
  items: string[];
  collections: Array<{ name: string; parent: number | null }>;
  memberships: Array<[number, number]>;
  tags: Array<{ name: string; color: TagColorId | null; position: number | null }>;
  assignments: Array<[number, number]>;
  duplicates?: number[][];
}

export interface FixtureSpec {
  collections: number;
  roots: number;
  maxDepth: number;
  tags: number;
  coloured: number;
  memberships: number;
  assignments: number;
  duplicateGroups: number;
  /** The share of items drawn out of every collection before memberships are drawn (some more end up with none by chance). */
  unfiledShare: number;
}
export const SPEC_12: FixtureSpec = {
  collections: 200, roots: 12, maxDepth: 4, tags: 50, coloured: 8, memberships: 30_000, assignments: 20_000, duplicateGroups: 50, unfiledShare: 0.1,
};

export interface ScopeFact {
  label: string;
  kind: 'all' | 'unfiled' | 'duplicates' | 'collection';
  collection?: number;
  /** Items in the view. */
  count: number;
  /** Index of the first row under the default sort (newest first = list order = lowest index). */
  first: number;
}
export interface OrganizeFacts {
  /** all, the three largest top-level collections (largest first), unfiled, duplicates. */
  scopes: ScopeFact[];
  tagCount: number[];
  tagFirst: number[];
  tagNames: string[];
  collectionNames: string[];
  duplicateItems: number;
}
export interface OrganizeFixture {
  spec: FixtureSpec;
  n: number;
  input: Omit<OrganizeSeedInput, 'items'>;
  facts: OrganizeFacts;
}

const ROOT_NAMES = ['분자생물학', '분석화학', '통계학', '열역학', '선형대수', '신경과학', '유기화학', '물리학', '진화생물학', '확률론', '면역학', '세포생물학'];
const PART_WORDS = ['개요', '실험', '연습', '요약', '과제', '부록'];
const COLOURED_TAG_NAMES = ['복습필요', '복원본', '시험범위', '읽는 중', '질문', '참고', '보류', '인용'];
/** Items 0 … RESERVED-1 never get the tag at position 1, so a key press on one of them starts from "not tagged". */
const RESERVED = 50;

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildOrganizeFixture(n: number, spec: FixtureSpec = SPEC_12, seed = 11): OrganizeFixture {
  const rand = mulberry32(seed);
  const int = (m: number) => Math.floor(rand() * m);
  if (spec.coloured > COLOURED_TAG_NAMES.length || spec.coloured > spec.tags || spec.coloured > TAG_COLORS.length) throw new Error('fixture: too many coloured tags');

  // Collections. The first beyond the roots chain down from root 0, so the deepest level is always there.
  const depth: number[] = [];
  const collections: OrganizeSeedInput['collections'] = [];
  for (let i = 0; i < spec.collections; i++) {
    let parent: number | null;
    if (i < spec.roots) parent = null;
    else if (i < spec.roots + spec.maxDepth - 1) parent = i === spec.roots ? 0 : i - 1;
    else {
      let p = int(i);
      while (depth[p]! >= spec.maxDepth) p = int(i);
      parent = p;
    }
    depth.push(parent === null ? 1 : depth[parent]! + 1);
    const part = PART_WORDS[int(PART_WORDS.length)]!;
    collections.push({ name: parent === null ? (ROOT_NAMES[i] ?? `주제 ${i + 1}`) : `${part} ${i + 1}`, parent });
  }

  // Memberships: distinct (collection, item) pairs over the items that are not set aside as unfiled.
  const filed: number[] = [];
  for (let i = 0; i < n; i++) if (rand() >= spec.unfiledShare) filed.push(i);
  if (spec.memberships > filed.length * spec.collections) throw new Error('fixture: more memberships than the library can hold');
  const memberships: Array<[number, number]> = [];
  const seenMember = new Set<number>();
  while (memberships.length < spec.memberships) {
    const item = filed[int(filed.length)]!;
    const c = int(spec.collections);
    if (seenMember.has(c * n + item)) continue;
    seenMember.add(c * n + item);
    memberships.push([c, item]);
  }

  // Tags: the first `coloured` get colour and position in the colour order; half the assignments go to them.
  const tags: OrganizeSeedInput['tags'] = Array.from({ length: spec.tags }, (_, k) =>
    k < spec.coloured
      ? { name: COLOURED_TAG_NAMES[k]!, color: TAG_COLORS[k]!.id, position: k + 1 }
      : { name: `주제 ${String(k - spec.coloured + 1).padStart(2, '0')}`, color: null, position: null },
  );
  const reserved = Math.min(RESERVED, Math.floor(n / 10));
  if (spec.assignments > (n - reserved) * spec.tags) throw new Error('fixture: more assignments than the library can hold');
  const assignments: Array<[number, number]> = [];
  const seenTag = new Set<number>();
  while (assignments.length < spec.assignments) {
    const t = rand() < 0.5 ? int(spec.coloured) : int(spec.tags);
    const item = int(n);
    if (t === 0 && item < reserved) continue;
    if (seenTag.has(t * n + item)) continue;
    seenTag.add(t * n + item);
    assignments.push([t, item]);
  }

  // Duplicate groups of 2–4 distinct items, no item in two groups.
  const used = new Set<number>();
  const duplicates: number[][] = [];
  for (let g = 0; g < spec.duplicateGroups; g++) {
    const size = 2 + int(3);
    const group: number[] = [];
    while (group.length < size) {
      const item = int(n);
      if (used.has(item)) continue;
      used.add(item);
      group.push(item);
    }
    duplicates.push(group.sort((a, b) => a - b));
  }

  return { spec, n, input: { collections, memberships, tags, assignments, duplicates }, facts: describe(n, spec, collections, memberships, assignments, duplicates, tags.map((t) => t.name)) };
}

/** The views and counts the timings wait for, derived from the drawn input (children come after parents, so one reverse pass folds a subtree in). */
function describe(
  n: number,
  spec: FixtureSpec,
  collections: OrganizeSeedInput['collections'],
  memberships: Array<[number, number]>,
  assignments: Array<[number, number]>,
  duplicates: number[][],
  tagNames: string[],
): OrganizeFacts {
  const sub: Array<Set<number>> = collections.map(() => new Set<number>());
  for (const [c, i] of memberships) sub[c]!.add(i);
  const filed = new Set(memberships.map(([, i]) => i));
  for (let c = collections.length - 1; c >= 0; c--) {
    const p = collections[c]!.parent;
    if (p !== null) for (const i of sub[c]!) sub[p]!.add(i);
  }
  const lowest = (xs: Iterable<number>) => Math.min(...xs);
  const roots = collections.flatMap((c, i) => (c.parent === null ? [i] : [])).sort((a, b) => sub[b]!.size - sub[a]!.size || a - b).slice(0, 3);
  const unfiled = [...Array(n).keys()].filter((i) => !filed.has(i));
  const dupItems = duplicates.flat();
  const tagSets = Array.from({ length: spec.tags }, () => new Set<number>());
  for (const [t, i] of assignments) tagSets[t]!.add(i);
  return {
    scopes: [
      { label: 'all', kind: 'all', count: n, first: 0 },
      ...roots.map((c): ScopeFact => ({ label: collections[c]!.name, kind: 'collection', collection: c, count: sub[c]!.size, first: lowest(sub[c]!) })),
      { label: 'unfiled', kind: 'unfiled', count: unfiled.length, first: unfiled[0]! },
      { label: 'duplicates', kind: 'duplicates', count: dupItems.length, first: lowest(dupItems) },
    ],
    tagCount: tagSets.map((s) => s.size),
    tagFirst: tagSets.map((s) => lowest(s)),
    tagNames,
    collectionNames: collections.filter((c) => c.parent === null).map((c) => c.name),
    duplicateItems: dupItems.length,
  };
}

interface Seeded { fixture: OrganizeFixture; ids: string[]; collectionIds: string[]; tagIds: string[] }

/**
 * Builds the fixture for the library's current items (list order, newest first), hands it to main in one transaction, and
 * checks the snapshot main sends back has the shape spec 12 names — a fixture that is not the one described would make
 * every timing after it a measurement of something else.
 */
export async function seedOrganizeFixture(app: ElectronApplication, page: Page, spec: FixtureSpec = SPEC_12): Promise<Seeded> {
  const ids = await page.evaluate(async () => {
    const r = await window.learn.library.list();
    if (!r.ok) throw new Error(`library.list failed: ${r.code}`);
    return r.data.map((i) => i.id);
  });
  const fixture = buildOrganizeFixture(ids.length, spec);
  const seeded = await app.evaluate(
    (_electron, input) => (globalThis as unknown as { __learnTest: { seedOrganize(i: typeof input): { collectionIds: string[]; tagIds: string[] } } }).__learnTest.seedOrganize(input),
    { ...fixture.input, items: ids },
  );
  const snap = await page.evaluate(async () => {
    const r = await window.learn.library.organize();
    if (!r.ok) throw new Error(`library.organize failed: ${r.code}`);
    const sum = (m: Record<string, string[]>) => Object.values(m).reduce((a, v) => a + v.length, 0);
    return {
      collections: r.data.collections.length,
      tags: r.data.tags.length,
      positions: r.data.tags.flatMap((t) => (t.position === null ? [] : [t.position])).sort((a, b) => a - b),
      members: sum(r.data.members),
      tagged: sum(r.data.tagged),
      duplicateGroups: r.data.duplicates.length,
      duplicateItems: r.data.duplicates.reduce((a, g) => a + g.length, 0),
    };
  });
  expect(snap, 'the snapshot main sends is the fixture spec 12 describes').toEqual({
    collections: spec.collections,
    tags: spec.tags,
    positions: Array.from({ length: spec.coloured }, (_, k) => k + 1),
    members: spec.memberships,
    tagged: spec.assignments,
    duplicateGroups: spec.duplicateGroups,
    duplicateItems: fixture.facts.duplicateItems,
  });
  return { fixture, ids, ...seeded };
}
