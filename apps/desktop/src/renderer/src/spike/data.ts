// Synthetic data for the M5 drag-and-drop spike (branch m5-spike only): 10,000 LibraryItems and 200 collections.
import type { LibraryItem } from '@learn/domain';

export const MIME_ITEMS = 'application/x-learn-items+json';
export const MIME_COLLECTION = 'application/x-learn-collection+json';
export const MIME_TAG = 'application/x-learn-tag+json';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['세포', '신호', '전달', '단백질', '효소', 'Signal', 'Protein', 'Enzyme', 'Linear', 'Algebra', '통계', '강의'];

export function makeItems(n: number): LibraryItem[] {
  const rnd = seeded(20261026);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const base = Date.UTC(2026, 9, 26);
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${String(i).padStart(5, '0')}`,
    title: `${pick(WORDS)} ${pick(WORDS)} ${i + 1}`,
    type: rnd() < 0.7 ? 'pdf' : 'video',
    mime: 'application/pdf',
    size: Math.floor(rnd() * 1e8),
    storageMode: 'managed',
    availability: 'available',
    assetId: `a-${i}`,
    revisionId: `r-${i}`,
    originalName: `file-${i}.pdf`,
    createdAt: new Date(base - i * 60_000).toISOString(),
    updatedAt: new Date(base - i * 60_000).toISOString(),
    creators: [],
    year: 2000 + (i % 26),
    publisher: null,
    tagIds: [],
    progress: null,
    openedAt: null,
  }));
}

export interface CollectionNode {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  children: CollectionNode[];
}

/** 200 collections, depth <= 4 (levels 1-4): 8 roots, then breadth-first with 3-4 children each until 200. */
export function makeCollections(total = 200): { roots: CollectionNode[]; byId: Map<string, CollectionNode> } {
  const byId = new Map<string, CollectionNode>();
  const roots: CollectionNode[] = [];
  let next = 0;
  const make = (parent: CollectionNode | null): CollectionNode => {
    const id = `c${String(next++).padStart(3, '0')}`;
    const node: CollectionNode = { id, name: `${parent ? parent.name.split(' ')[0] : '과목'} ${id.slice(1)}`, parentId: parent?.id ?? null, level: (parent?.level ?? 0) + 1, children: [] };
    byId.set(id, node);
    (parent ? parent.children : roots).push(node);
    return node;
  };
  for (let i = 0; i < 8; i++) make(null);
  const queue = [...roots];
  while (next < total && queue.length > 0) {
    const parent = queue.shift()!;
    if (parent.level >= 4) continue;
    const kids = 3 + (parent.level % 2);
    for (let k = 0; k < kids && next < total; k++) queue.push(make(parent));
  }
  return { roots, byId };
}

export const descendantIds = (node: CollectionNode): string[] => node.children.flatMap((c) => [c.id, ...descendantIds(c)]);
