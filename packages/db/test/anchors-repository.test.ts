import { describe, expect, it, vi } from 'vitest';
import { LearnError, newId, type PdfAnchor, type SourceAnchor } from '@learn/domain';
import { AnchorsRepository } from '../src/index';
import { freshDb, seedItem } from './fixtures';

const pdf = (revisionId: string, over: Partial<PdfAnchor> = {}): PdfAnchor => ({
  kind: 'pdf', revisionId, precision: 'span', pageIndex: 3, quads: [[1, 2, 3, 4, 5, 6, 7, 8]], coordinateSpace: 'pdf-user-space',
  text: { quote: { exact: 'dominant model', prefix: 'The ', suffix: ' is' }, position: { start: 10, end: 24 } },
  ...over,
});

describe('AnchorsRepository', () => {
  it('round-trips an anchor with its text and one without', () => {
    const db = freshDb();
    const { revisionId } = seedItem(db);
    const repo = new AnchorsRepository(db);
    const span = repo.create(pdf(revisionId));
    const region = repo.create(pdf(revisionId, { precision: 'region', text: undefined }));
    expect(repo.get(span.id)).toEqual({ id: span.id, anchor: pdf(revisionId), status: 'ok', schemaVersion: 2 });
    expect(repo.get(region.id)?.anchor).toEqual(pdf(revisionId, { precision: 'region', text: undefined }));
    expect(db.prepare('SELECT kind, precision, quote, text_json FROM anchors WHERE id = ?').get(span.id)).toMatchObject({
      kind: 'pdf', precision: 'span', quote: 'dominant model',
    });
    expect(db.prepare('SELECT precision, quote, text_json, locator_json FROM anchors WHERE id = ?').get(region.id)).toMatchObject({
      precision: 'region', quote: null, text_json: null,
    });
    expect(repo.get(newId())).toBeUndefined();
  });

  it('stores the non-pdf kinds with their precision', () => {
    const db = freshDb();
    const { revisionId } = seedItem(db);
    const repo = new AnchorsRepository(db);
    const video: SourceAnchor = { kind: 'video', revisionId, startMs: 0, endMs: 10 };
    const slide: SourceAnchor = { kind: 'slides', revisionId, derivedRevisionId: newId(), slideIndex: 0, quads: [] };
    expect(repo.get(repo.create(video).id)?.anchor).toEqual(video);
    const s = repo.create(slide);
    expect(repo.get(s.id)?.anchor).toEqual(slide);
    expect(db.prepare('SELECT precision FROM anchors WHERE id = ?').get(s.id)).toEqual({ precision: 'region' });
  });

  it('refuses a span without text and an unknown revision', () => {
    const db = freshDb();
    const { revisionId } = seedItem(db);
    const repo = new AnchorsRepository(db);
    const bad = (): unknown => repo.create(pdf(revisionId, { text: undefined }));
    expect(bad).toThrow(LearnError);
    expect(bad).toThrow('앵커가 올바르지 않습니다.');
    try { bad(); } catch (e) { expect((e as LearnError).code).toBe('VALIDATION_FAILED'); }
    try { repo.create(pdf(newId())); expect.unreachable(); } catch (e) { expect((e as LearnError).code).toBe('NOT_FOUND'); }
  });

  it('lists a revision\'s anchors in creation order and skips a row that no longer parses', () => {
    const db = freshDb();
    const a = seedItem(db).revisionId;
    const b = seedItem(db).revisionId;
    const repo = new AnchorsRepository(db);
    const first = repo.create(pdf(a, { pageIndex: 0 }));
    db.prepare(`INSERT INTO anchors (id, revision_id, kind, locator_json, schema_version) VALUES ('old', ?, 'pdf', '{}', 1)`).run(a);
    const second = repo.create(pdf(a, { pageIndex: 1 }));
    repo.create(pdf(b));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(repo.listByRevision(a).map((r) => r.id)).toEqual([first.id, second.id]);
    expect(warn).toHaveBeenCalledWith('ANCHOR_INVALID', 'old');
    expect(repo.get('old')).toBeUndefined();
    warn.mockRestore();
  });
});
