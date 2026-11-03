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

function precisionOf(anchor: SourceAnchor): 'span' | 'region' {
  if (anchor.kind === 'pdf') return anchor.precision;
  return anchor.kind === 'slide' ? 'region' : 'span';
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

/** Anchors: where in a source revision something points. Text lives in its own column so it can be searched and replaced alone. */
export class AnchorsRepository {
  constructor(private readonly db: Db) {}

  create(input: SourceAnchor): AnchorRecord {
    const parsed = sourceAnchor.safeParse(input);
    if (!parsed.success) throw new LearnError('VALIDATION_FAILED', '앵커가 올바르지 않습니다.');
    const anchor = parsed.data;
    return this.db.transaction(() => {
      const revision = this.db.prepare('SELECT 1 FROM source_revisions WHERE id = ?').get(anchor.revisionId);
      if (!revision) throw new LearnError('NOT_FOUND', '원본 판본을 찾을 수 없습니다.');
      const { text, ...locator } = anchor as SourceAnchor & { text?: unknown };
      const id = newId();
      this.db
        .prepare(`INSERT INTO anchors (id, revision_id, kind, precision, locator_json, text_json, quote, schema_version)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id, anchor.revisionId, anchor.kind, precisionOf(anchor), JSON.stringify(locator),
          text === undefined ? null : JSON.stringify(text),
          anchor.kind === 'pdf' ? (anchor.text?.quote.exact ?? null) : 'quote' in anchor ? anchor.quote.exact : null,
          ANCHOR_SCHEMA_VERSION,
        );
      return { id, anchor, status: 'ok' as const, schemaVersion: ANCHOR_SCHEMA_VERSION };
    })();
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
