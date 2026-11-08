// What a restore must bring back (M6 spec 9.2, AC15), read through the page as the app shows it, and the counts the P1 gate
// compares. Playwright is a type here only, so the counts are unit-tested (library-facts.unit.ts).
import type { Page } from '@playwright/test';
import { unpackOrganize } from '../../packages/domain/src/organize';

/** Everything a restore must bring back, read through the page as the app shows it (spec 9.2, AC15). */
export async function libraryFacts(page: Page) {
  const read = await page.evaluate(async () => {
    const un = <T>(r: { ok: true; data: T } | { ok: false; code: string }): T => {
      if (!r.ok) throw new Error(r.code);
      return r.data;
    };
    const items = un(await window.learn.library.list());
    const trash = un(await window.learn.library.trashView());
    const wire = un(await window.learn.library.organize());
    const files: Record<string, { title: string; sha256: string; storageMode: string; availability: string; tags: string[]; collections: string[] }> = {};
    for (const it of [...items, ...trash.items]) {
      const d = un(await window.learn.library.detail({ itemId: it.id }));
      files[it.id] = {
        title: it.title, sha256: d.file.sha256, storageMode: d.file.storageMode, availability: d.file.availability,
        tags: d.tags.map((t) => t.name).sort(), collections: d.collections.map((c) => c.name).sort(),
      };
    }
    return { items, trash, wire, files };
  });
  // The wire form is unpacked here with the domain's own function, not by a second formula in the page.
  const organize = unpackOrganize(read.wire);
  const byId = <T extends { id: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  const sorted = (r: Record<string, string[]>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [...v].sort()] as const).sort(([a], [b]) => a.localeCompare(b)));
  const { items, trash, files } = read;
  return {
    items: items.map((i) => i.id).sort(),
    trashed: byId(trash.items.map((i) => ({ id: i.id, deletedAt: i.deletedAt }))),
    trashedCollections: byId(trash.collections),
    collections: byId(organize.collections),
    tags: byId(organize.tags),
    members: sorted(organize.members),
    tagged: sorted(organize.tagged),
    trashMembers: sorted(trash.members),
    trashTagged: sorted(trash.tagged),
    trashCount: organize.trashCount,
    files,
  };
}
export type LibraryFacts = Awaited<ReturnType<typeof libraryFacts>>;

export interface FactCounts {
  items: number;
  trashed: number;
  collections: number;
  trashedCollections: number;
  tags: number;
  memberships: number;
  assignments: number;
}

/** What a count reads of the facts: lists of anything and id maps (the unit test passes plain ones). */
export interface CountedFacts {
  items: readonly unknown[];
  trashed: readonly unknown[];
  collections: readonly unknown[];
  trashedCollections: readonly unknown[];
  tags: readonly unknown[];
  members: Readonly<Record<string, readonly string[]>>;
  trashMembers: Readonly<Record<string, readonly string[]>>;
  tagged: Readonly<Record<string, readonly string[]>>;
  trashTagged: Readonly<Record<string, readonly string[]>>;
}

/**
 * AC15's counts: live and trashed items, live and trashed collection rows, tags, and the memberships and tag assignments of
 * live and trashed items together — a trashed item keeps its own (spec 4.1), so a restore must bring those back too.
 */
export function factCounts(f: CountedFacts): FactCounts {
  const pairs = (...maps: ReadonlyArray<Readonly<Record<string, readonly string[]>>>): number =>
    maps.reduce((n, m) => n + Object.values(m).reduce((k, ids) => k + ids.length, 0), 0);
  return {
    items: f.items.length,
    trashed: f.trashed.length,
    collections: f.collections.length,
    trashedCollections: f.trashedCollections.length,
    tags: f.tags.length,
    memberships: pairs(f.members, f.trashMembers),
    assignments: pairs(f.tagged, f.trashTagged),
  };
}
