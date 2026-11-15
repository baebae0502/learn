import { ANCHOR_SCHEMA_VERSION, LearnError, newId, sourceAnchor, type SourceAnchor } from '@learn/domain';
import type { Db } from './connection';

export interface AnchorRecord {
  id: string;
  anchor: SourceAnchor;
  status: 'ok' | 'review' | 'orphan';
  schemaVersion: number;
}

interface AnchorDbRow { id: string; locator_json: string; text_json: string | null; status: AnchorRecord['status']; schema_version: number }

const SELECT = 'SELECT id, locator_json, text_json, status, schema_version FROM anchors';

function precisionOf(anchor: SourceAnchor): 'span' | 'region' | 'page' {
  if (anchor.kind === 'pdf') return anchor.precision;
  return anchor.kind === 'slides' || anchor.kind === 'image' ? 'region' : 'span';
}

/** The row, or undefined (with a warning) when it no longer parses, so one bad row never hides the others. */
function toRecord(r: AnchorDbRow): AnchorRecord | undefined {
  try {
    const parsed = sourceAnchor.safeParse({ ...JSON.parse(r.locator_json), ...(r.text_json === null ? {} : { text: JSON.parse(r.text_json) }) });
    if (parsed.success) return { id: r.id, anchor: parsed.data, status: r.status, schemaVersion: r.schema_version };
  } catch {
    // falls through to the warning
  }
  console.warn('ANCHOR_INVALID', r.id);
  return undefined;
}

function insertAnchor(db: Db, anchor: SourceAnchor): AnchorRecord {
  const revision = db.prepare('SELECT 1 FROM source_revisions WHERE id = ?').get(anchor.revisionId);
  if (!revision) throw new LearnError('NOT_FOUND', '원본 판본을 찾을 수 없습니다.');
  const { text, ...locator } = anchor as SourceAnchor & { text?: unknown };
  const id = newId();
  db.prepare(`INSERT INTO anchors (id, revision_id, kind, precision, locator_json, text_json, quote, schema_version)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id, anchor.revisionId, anchor.kind, precisionOf(anchor), JSON.stringify(locator),
      text === undefined ? null : JSON.stringify(text),
      anchor.kind === 'pdf' ? ('text' in anchor ? (anchor.text?.quote.exact ?? null) : null) : 'quote' in anchor ? anchor.quote.exact : null,
      ANCHOR_SCHEMA_VERSION,
    );
  return { id, anchor, status: 'ok', schemaVersion: ANCHOR_SCHEMA_VERSION };
}

/** Inside the caller's transaction: the page anchor of this revision and page, made the first time (main is the only writer). */
export function pageAnchorIn(db: Db, revisionId: string, pageIndex: number): AnchorRecord {
  const found = db
    .prepare(`${SELECT} WHERE revision_id = ? AND kind = 'pdf' AND precision = 'page' AND json_extract(locator_json, '$.pageIndex') = ? ORDER BY rowid LIMIT 1`)
    .get(revisionId, pageIndex) as AnchorDbRow | undefined;
  const record = found && toRecord(found);
  if (record) return record;
  return insertAnchor(db, { kind: 'pdf', revisionId, precision: 'page', pageIndex });
}

/** Anchors: where in a source revision something points. Text lives in its own column so it can be searched and replaced alone. */
export class AnchorsRepository {
  constructor(private readonly db: Db) {}

  create(input: SourceAnchor): AnchorRecord {
    const parsed = sourceAnchor.safeParse(input);
    if (!parsed.success) throw new LearnError('VALIDATION_FAILED', '앵커가 올바르지 않습니다.');
    const anchor = parsed.data;
    return this.db.transaction(() => insertAnchor(this.db, anchor))();
  }

  pageAnchor(revisionId: string, pageIndex: number): AnchorRecord {
    return this.db.transaction(() => pageAnchorIn(this.db, revisionId, pageIndex))();
  }

  get(id: string): AnchorRecord | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as AnchorDbRow | undefined;
    return row && toRecord(row);
  }

  listByRevision(revisionId: string): AnchorRecord[] {
    return (this.db.prepare(`${SELECT} WHERE revision_id = ? ORDER BY rowid`).all(revisionId) as AnchorDbRow[])
      .flatMap((r) => toRecord(r) ?? []);
  }
}
