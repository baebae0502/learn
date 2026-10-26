import { newId, type LearnEventMap } from '@learn/domain';
import type { LibraryRepository } from '@learn/db';

/** One seeded item's facts, as E2E sends them (tests/e2e/helpers.ts seedRows): main keeps no sample data itself. */
export interface SeedRow {
  title: string;
  creators: string[];
  year: number | null;
  createdAt: string;
}
export interface SeedItemsInput {
  fromItemId: string;
  rows: SeedRow[];
}
export type SeedRepo = Pick<LibraryRepository, 'getItem' | 'insertItemsForAsset'>;

/**
 * Items for `rows` that share the file of the managed item `fromItemId` — its asset and revision — written in one
 * transaction (LibraryRepository.insertItemsForAsset). A large library in seconds, without copying a file per item.
 */
export function seedItems(repo: SeedRepo, input: SeedItemsInput, makeId: () => string = newId): string[] {
  const from = repo.getItem(input.fromItemId);
  if (!from) throw new Error('seedItems: unknown source item');
  if (from.storageMode !== 'managed') throw new Error('seedItems: the source item must be a managed copy');
  const rows = input.rows.map((r) => ({
    id: makeId(),
    type: from.type,
    title: r.title,
    createdAt: r.createdAt,
    metadataJson: JSON.stringify({ creators: r.creators.map((name) => ({ name, role: 'author' })), ...(r.year === null ? {} : { date: String(r.year) }) }),
    assetId: from.assetId,
    revisionId: from.revisionId,
  }));
  repo.insertItemsForAsset(rows);
  return rows.map((r) => r.id);
}

export interface LearnTestHooks {
  /** Returns how many items were added. */
  seedItems(input: SeedItemsInput): number;
}

/**
 * E2E only (index.ts installs it when isE2E): `globalThis.__learnTest`, which tests call through app.evaluate. One
 * libraryChanged{import} for the whole batch, without ids: the renderer reads the list once.
 */
export function installTestHooks(deps: {
  repo(): SeedRepo;
  broadcast(name: 'libraryChanged', payload: LearnEventMap['libraryChanged']): void;
}): void {
  (globalThis as { __learnTest?: LearnTestHooks }).__learnTest = {
    seedItems(input) {
      const ids = seedItems(deps.repo(), input);
      deps.broadcast('libraryChanged', { reason: 'import' });
      return ids.length;
    },
  };
}
