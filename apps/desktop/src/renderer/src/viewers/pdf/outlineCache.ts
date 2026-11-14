import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { StoreApi } from 'zustand/vanilla';
import { TUTOR_LIMITS, type TutorAskInput } from '@learn/domain';
import { flattenOutline, outlinePages, outlineRows, type OutlineRow } from './outline';
import type { ReaderStore } from './readerStore';

/**
 * A tab's outline of the document it shows (spec 5.1): every entry as a tree and in reading order, and the page (from 1) of
 * each entry resolved so far — the entries in reading order are resolved from the first, `resolvedUpTo` of them by now. The outline
 * pane and the tutor read the same cache, so each entry's page is asked once.
 */
export interface OutlineCache {
  rows: OutlineRow[];
  flat: OutlineRow[];
  pages: ReadonlyMap<string, number>;
  resolvedUpTo: number;
}

/** The resolving of one document's outline for one tab: how far it is wanted, and whether its loop runs. */
interface Job {
  doc: PDFDocumentProxy;
  want: number;
  running: boolean;
}
const jobs = new WeakMap<StoreApi<ReaderStore>, Job>();

/**
 * The tab's outline cache for `doc`, made if there is none, and its pages resolved in the background to the first `want` entries in
 * reading order (or all of them), a batch at a time; nothing is asked twice. The tutor asks for the first 300 when it shows, the
 * outline pane for all, from where the tutor's left off. Never waited for: a question carries what is resolved when it goes.
 */
export function ensureOutline(scope: { reader: StoreApi<ReaderStore> }, doc: PDFDocumentProxy, want: number | 'all'): void {
  const store = scope.reader;
  let job = jobs.get(store);
  if (job?.doc !== doc) {
    job = { doc, want: 0, running: false };
    jobs.set(store, job);
    store.getState().setOutline(null);
  }
  const target = want === 'all' ? Infinity : want;
  if (target <= job.want) return;
  job.want = target;
  if (!job.running) void resolve(store, job);
}

/** The tab's document went away (the view's teardown): its cache goes, and what was still being resolved for it is dropped. */
export function dropOutline(scope: { reader: StoreApi<ReaderStore> }): void {
  jobs.delete(scope.reader);
  scope.reader.getState().setOutline(null);
}

async function resolve(store: StoreApi<ReaderStore>, job: Job): Promise<void> {
  job.running = true;
  const live = () => jobs.get(store) === job;
  try {
    if (store.getState().outline === null) {
      let rows: OutlineRow[];
      try {
        rows = outlineRows(await job.doc.getOutline());
      } catch (e) {
        // A document that closes under the request is not an outline that failed to load; anything else is "no outline".
        if (!live()) return;
        console.warn(`[pdf] outline failed: ${(e as Error)?.name ?? 'Error'}`);
        rows = [];
      }
      if (!live()) return;
      store.getState().setOutline({ rows, flat: flattenOutline(rows), pages: new Map(), resolvedUpTo: 0 });
    }
    // More may be wanted while a run is out (the outline pane opens while the tutor's 300 resolve): the loop goes on from there.
    for (;;) {
      const cache = store.getState().outline;
      if (!live() || cache === null) return;
      const end = Math.min(job.want, cache.flat.length);
      if (cache.resolvedUpTo >= end) return;
      await outlinePages(
        job.doc,
        cache.rows,
        () => !live(),
        (found, upTo) => {
          const now = store.getState().outline;
          if (!live() || now === null) return;
          store.getState().setOutline({ ...now, pages: new Map([...now.pages, ...found]), resolvedUpTo: upTo });
        },
        { from: cache.resolvedUpTo, limit: end - cache.resolvedUpTo },
      );
    }
  } finally {
    job.running = false;
  }
}

/** At most `n` UTF-16 units, never ending inside a surrogate pair. */
function cut(text: string, n: number): string {
  if (text.length <= n) return text;
  const head = text.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

/**
 * What a question carries of the outline (spec 5.1), as the cache has it now: the first 300 entries in reading order, titles cut
 * at 300 characters and depths at 8 (a deeper entry is sent at that depth), each with its page (0-based) or null — no destination, a broken one, or not resolved yet; whether
 * those entries are all resolved, and how many entries the document's outline has. No cache yet: nothing, not complete.
 */
export function outlineSnapshot(c: OutlineCache | null): { outline: TutorAskInput['reader']['outline']; outlineComplete: boolean; outlineTotal: number } {
  if (c === null) return { outline: [], outlineComplete: false, outlineTotal: 0 };
  const first = c.flat.slice(0, TUTOR_LIMITS.outlineEntries);
  return {
    outline: first.map((row) => {
      const page = c.pages.get(row.id);
      return { title: cut(row.title, TUTOR_LIMITS.outlineTitle), depth: Math.min(row.depth, TUTOR_LIMITS.outlineDepth), pageIndex: page !== undefined && page >= 1 ? page - 1 : null };
    }),
    outlineComplete: c.resolvedUpTo >= first.length,
    outlineTotal: c.flat.length,
  };
}
