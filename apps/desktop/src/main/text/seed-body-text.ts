import { extractKey, nowIso, newId, type ExtractPayload } from '@learn/domain';
import { seedAssets, type SeedAssetsDeps } from '../test-hooks';

export interface SeedBodyTextInput {
  docs: number;
  pages: number;
  chars: number;
  seed: number;
  /** The jobs finished at a limit (an index of the first `pages` pages only). */
  truncated?: boolean;
}

const EN = ['signal', 'transduction', 'protein', 'receptor', 'membrane', 'kinase', 'pathway', 'expression', 'cellular', 'molecular',
  'analysis', 'method', 'result', 'sample', 'structure', 'function', 'binding', 'activity', 'response', 'control', 'model', 'network',
  'sequence', 'genome', 'enzyme', 'inhibitor', 'phosphorylation', 'regulation', 'microscopy', 'fluorescence', 'imaging', 'tissue',
  'neuron', 'synapse', 'channel', 'ligand', 'assay', 'culture', 'antibody', 'dynamics'];
// Cell-biology words, written as escapes: main keeps its Hangul in strings.ts.
const KO = ['\uD615\uAD11', '\uC138\uD3EC', '\uD604\uBBF8\uACBD', '\uB2E8\uBC31\uC9C8', '\uC2E0\uD638', '\uAD00\uCC30', '\uAE30\uB85D', '\uBD84\uC11D', '\uC2E4\uD5D8', '\uACB0\uACFC', '\uC870\uC9C1', '\uC2E0\uACBD', '\uC218\uC6A9\uCCB4', '\uD6A8\uC18C', '\uC720\uC804\uC790', '\uBC1C\uD604', '\uAD6C\uC870', '\uAE30\uB2A5', '\uBC18\uC751', '\uD45C\uBCF8'];

/** One page of synthetic text: the same arguments always give the same text, one word in five Korean. "zq" and "xylophone" never occur. */
export function bodyTextPage(seed: number, doc: number, page: number, chars: number): string {
  let x = (seed * 1_000_003 + doc * 1009 + page) % 2 ** 31;
  let text = '';
  for (let k = 0; text.length < chars; k++) {
    // 32-bit integer arithmetic: the product in doubles would lose its low bits, and with them half of the words.
    x = (Math.imul(1103515245, x) + 12345) & 0x7fffffff;
    const table = k % 5 === 4 ? KO : EN;
    text += (k === 0 ? '' : ' ') + table[(x >>> 16) % table.length]!;
  }
  return text.slice(0, chars);
}

const TITLE = '\uBCF8\uBB38';

const COMMIT_EVERY = 1000;

/**
 * `docs` PDF items (titled with a running number, newest first) whose body text is already stored: `pages` pages of `chars` characters each and a
 * finished extract job, written in transactions of 1,000 pages. E2E only: a library of any size to search without waiting for the worker.
 */
export function seedBodyText(deps: SeedAssetsDeps, input: SeedBodyTextInput): { itemIds: string[]; sha256: string[] } {
  const { docs, pages, chars, seed, truncated = false } = input;
  for (const [name, v] of Object.entries({ docs, pages, chars })) if (!Number.isInteger(v) || v < 0) throw new Error(`seedBodyText: ${name} must be a whole number`);
  const base = Date.now();
  const made = seedAssets(deps, {
    rows: Array.from({ length: docs }, (_, i) => ({
      title: `${TITLE} ${i + 1}`,
      creators: [],
      year: null,
      createdAt: new Date(base - i * 1000).toISOString(),
    })),
  });
  const insertPage = deps.db.prepare('INSERT INTO page_texts (sha256, page_index, text) VALUES (?, ?, ?)');
  const insertJob = deps.db.prepare(
    `INSERT INTO jobs (id, kind, dedupe_key, state, attempts, progress, payload_json, created_at, updated_at) VALUES (?, 'extract', ?, 'done', 1, 1, ?, ?, ?)`,
  );
  const now = nowIso();
  let inBatch = 0;
  let open: (() => void) | null = null;
  const begin = (): void => void deps.db.exec('BEGIN');
  const commit = (): void => void deps.db.exec('COMMIT');
  begin();
  open = commit;
  try {
    made.sha256.forEach((sha256, doc) => {
      for (let page = 0; page < pages; page++) {
        insertPage.run(sha256, page, bodyTextPage(seed, doc, page, chars));
        if (++inBatch >= COMMIT_EVERY) {
          commit();
          begin();
          inBatch = 0;
        }
      }
      const payload: ExtractPayload = { sha256, type: 'pdf', nextPage: pages, pages, chars: pages * chars, truncated };
      insertJob.run(newId(), extractKey(sha256), JSON.stringify(payload), new Date(base - doc * 1000).toISOString(), now);
    });
    commit();
    open = null;
  } finally {
    if (open) deps.db.exec('ROLLBACK');
  }
  return made;
}
