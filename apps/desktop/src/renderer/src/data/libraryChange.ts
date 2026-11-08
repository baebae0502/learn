import type { LearnEventMap, LibraryChangeReason, LibraryItem } from '@learn/domain';

/** Ids per notice that are read one by one (spec 10.3); more than this reads the whole list. */
export const NARROW_LIMIT = 500;
/** The reasons that change an item's own row and nothing about which items exist. */
const NARROW: ReadonlySet<LibraryChangeReason> = new Set<LibraryChangeReason>(['metadata', 'relink', 'availability', 'opened', 'position']);

export interface ChangeDeps {
  /** The list in the query cache, or undefined before it was first read. */
  cached(): readonly LibraryItem[] | undefined;
  /** A read of the whole list is running. */
  refetching(): boolean;
  /** Stores a patched list. */
  put(prev: readonly LibraryItem[], next: readonly LibraryItem[]): void;
  getItems(ids: string[]): Promise<LibraryItem[]>;
  /** Everything under ['library']: the list, the snapshot, the search texts, every item and detail. */
  invalidateAll(): void;
  invalidateOrganize(): void;
  /** The trash view's rows (['library','trash']), which the snapshot does not carry. */
  invalidateTrash(): void;
  invalidateItem(itemId: string): void;
  invalidateTexts(): void;
  /** One item's detail (its body state is part of it), nothing else of the item. */
  invalidateDetail(itemId: string): void;
  /** The body search results (['search']): they are not under ['library']. */
  invalidateBody(): void;
  /** Runs `fn` at the window's next idle moment, or after `ms` at the latest; the answer cancels it. */
  whenIdle(fn: () => void, ms: number): () => void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  now(): number;
}

/** The whole list is read again at most once in this long for import notices (a run files many files, one notice each). */
export const IMPORT_READ_GAP_MS = 1000;
/** The body search is read again at most once in this long for text notices (one comes at the end of every extraction job). */
export const BODY_READ_GAP_MS = 1000;
/** A tag change this window made itself stops being waited for after this long: the notice did not come. */
export const ECHO_WAIT_MS = 5000;

export interface ChangeHandler {
  onChange(change: LearnEventMap['libraryChanged']): void;
  /** import:finished: the whole read that was put off (waiting for a second to pass or for idle) happens now. */
  flushImports(): void;
  /**
   * A change this window made itself and already put into its snapshot: the next notice of this reason that names only
   * items among `itemIds` is not read again. Asked for before the call, so a notice that beats the answer is covered too.
   */
  expectEcho(reason: 'tags', itemIds: readonly string[]): void;
}

const same = (a: LibraryItem, b: LibraryItem): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The list with `fresh` put over its rows, or null when it cannot be patched: an item that was asked for did not come
 * back (it left the library) or one came back that the list has no row for. An unchanged list comes back as it is.
 */
function patched(list: readonly LibraryItem[], ids: readonly string[], fresh: readonly LibraryItem[]): readonly LibraryItem[] | null {
  const byId = new Map(fresh.map((i) => [i.id, i]));
  if (ids.some((id) => !byId.has(id))) return null;
  const at = new Map(list.map((i, k) => [i.id, k]));
  let next: LibraryItem[] | null = null;
  for (const item of fresh) {
    const k = at.get(item.id);
    if (k === undefined) return null;
    if (same(list[k]!, item)) continue;
    next ??= [...list];
    next[k] = item;
  }
  return next ?? list;
}

/**
 * What the renderer reads again after `libraryChanged` (spec 10.3). Collections and tags change only the snapshot (and a
 * collection moved to or from the trash, the trash view's rows). A change to the rows of known items (metadata, relink,
 * availability, opened) with 1-500 ids reads those items and puts them into the cached list; trash, restore and purge read
 * the whole list, the snapshot and the trash view with it at once, and import does the same at an idle moment and at most
 * once a second. A patch that a whole-list read overtook is dropped (the whole read has the change), and a patch that
 * cannot be applied falls back to the whole read.
 */
export function createChangeHandler(d: ChangeDeps): ChangeHandler {
  let epoch = 0;
  let lastImportRead = Number.NEGATIVE_INFINITY;
  let importTimer: unknown = null;
  let importIdle: (() => void) | null = null;
  let bodyTimer: unknown = null;
  let echoes: Array<{ ids: Set<string>; timer: unknown }> = [];

  const cancelImport = (): void => {
    if (importTimer !== null) d.clearTimer(importTimer);
    importTimer = null;
    importIdle?.();
    importIdle = null;
  };
  const cancelBody = (): void => {
    if (bodyTimer !== null) d.clearTimer(bodyTimer);
    bodyTimer = null;
  };
  const everything = (): void => {
    cancelImport(); // the read below has what a put-off import read would
    cancelBody();
    epoch += 1;
    d.invalidateAll();
    d.invalidateBody();
  };
  const importRead = (): void => {
    lastImportRead = d.now();
    everything();
  };
  const readAtIdle = (): void => {
    importIdle = d.whenIdle(importRead, IMPORT_READ_GAP_MS);
  };
  const onImport = (): void => {
    if (importTimer !== null || importIdle !== null) return; // that read comes after this notice
    const wait = lastImportRead + IMPORT_READ_GAP_MS - d.now();
    if (wait <= 0) {
      readAtIdle();
      return;
    }
    importTimer = d.setTimer(() => {
      importTimer = null;
      readAtIdle();
    }, wait);
  };
  const bodyLater = (): void => {
    if (bodyTimer !== null) return;
    bodyTimer = d.setTimer(() => {
      bodyTimer = null;
      d.invalidateBody();
    }, BODY_READ_GAP_MS);
  };
  /** Whether this notice is the echo of a change this window made: consumed once. */
  const echoed = (ids: readonly string[]): boolean => {
    if (ids.length === 0) return false;
    const at = echoes.findIndex((e) => ids.every((id) => e.ids.has(id)));
    if (at < 0) return false;
    d.clearTimer(echoes[at]!.timer);
    echoes = echoes.filter((_, k) => k !== at);
    return true;
  };

  return {
    onChange({ reason, itemIds }) {
      if (reason === 'collections' || reason === 'tags') {
        if (reason === 'tags' && itemIds !== undefined && echoed(itemIds)) return;
        d.invalidateOrganize();
        if (reason === 'collections') d.invalidateTrash();
        return;
      }
      const ids = itemIds === undefined ? [] : [...new Set(itemIds)];
      // Body text moved on: the panel's state changes now, the body matches once in a while (a job ends every few seconds).
      if (reason === 'text') {
        for (const id of ids) d.invalidateDetail(id);
        bodyLater();
        return;
      }
      if (reason === 'import') {
        onImport();
        return;
      }
      if (!NARROW.has(reason) || ids.length === 0 || ids.length > NARROW_LIMIT || d.cached() === undefined || d.refetching()) {
        everything();
        return;
      }
      const started = epoch;
      for (const id of ids) d.invalidateItem(id);
      // A relinked file can have another sha256, which moves the duplicate groups.
      if (reason === 'relink') d.invalidateOrganize();
      if (reason === 'metadata') d.invalidateTexts();
      d.getItems(ids).then(
        (fresh) => {
          if (started !== epoch) return;
          const list = d.cached();
          const next = list === undefined ? null : patched(list, ids, fresh);
          if (list === undefined || next === null) everything();
          else if (next !== list) d.put(list, next);
        },
        () => everything(),
      );
    },
    flushImports() {
      if (importTimer === null && importIdle === null) return;
      importRead();
    },
    expectEcho(_reason, itemIds) {
      const entry = { ids: new Set(itemIds), timer: null as unknown };
      entry.timer = d.setTimer(() => {
        echoes = echoes.filter((e) => e !== entry);
      }, ECHO_WAIT_MS);
      echoes.push(entry);
    },
  };
}
