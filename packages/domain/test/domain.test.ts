import { describe, expect, it } from 'vitest';
import {
  APP_ORIGIN, ANCHOR_SCHEMA_VERSION, LearnError, assetUrl, commandContextInput, createCollectionInput, createTagInput, fail, failureFrom, getItemsInput, importPathsInput,
  VIDEO_FORMATS, nameSchema, newId, nowIso, ok, pickAndImportInput, renameCollectionInput, renameTagInput, sourceAnchor, toLearnError, updateMetadataInput,
} from '../src/index';

describe('ids', () => {
  it('creates v4 UUIDs and UTC ISO timestamps', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('errors and results', () => {
  it('maps fs error codes to LearnError codes', () => {
    expect(toLearnError(Object.assign(new Error('x'), { code: 'ENOENT' })).code).toBe('NOT_FOUND');
    expect(toLearnError(Object.assign(new Error('x'), { code: 'EACCES' })).code).toBe('PERMISSION_DENIED');
    const full = toLearnError(Object.assign(new Error('x'), { code: 'ENOSPC' }));
    expect(full.code).toBe('DISK_FULL');
    expect(full.retryable).toBe(true);
    expect(toLearnError(new Error('boom')).code).toBe('INTERNAL');
  });
  it('keeps LearnError as-is', () => {
    const e = new LearnError('HASH_MISMATCH', '다름', { retryable: true });
    expect(toLearnError(e)).toBe(e);
  });
  it('builds result envelopes', () => {
    expect(ok(3)).toEqual({ ok: true, data: 3 });
    expect(fail('NOT_FOUND', '없음')).toEqual({ ok: false, code: 'NOT_FOUND', message: '없음', retryable: false });
    expect(failureFrom(new LearnError('DUPLICATE', '중복'))).toEqual({ ok: false, code: 'DUPLICATE', message: '중복', retryable: false });
  });
});

describe('anchors (spec 08 examples)', () => {
  const revisionId = newId();
  it('accepts a pdf anchor in pdf-user-space', () => {
    const r = sourceAnchor.safeParse({
      kind: 'pdf', revisionId, pageIndex: 41, quads: [[1, 2, 3, 4, 5, 6, 7, 8]], coordinateSpace: 'pdf-user-space',
      quote: { exact: 'A signaling cascade', prefix: '', suffix: ' can amplify' },
    });
    expect(r.success).toBe(true);
  });
  it('accepts a video anchor with normalized rect', () => {
    const r = sourceAnchor.safeParse({
      kind: 'video', revisionId, startMs: 758000, endMs: 768000,
      frame: { atMs: 758000, width: 1920, height: 1080 }, rect: [0.2, 0.3, 0.4, 0.2],
    });
    expect(r.success).toBe(true);
  });
  it('rejects inverted time ranges and out-of-frame rects', () => {
    expect(sourceAnchor.safeParse({ kind: 'video', revisionId, startMs: 10, endMs: 5 }).success).toBe(false);
    expect(sourceAnchor.safeParse({ kind: 'video', revisionId, startMs: 0, endMs: 5, rect: [0.8, 0, 0.4, 0.1] }).success).toBe(false);
  });
  it('exposes schema version 1', () => expect(ANCHOR_SCHEMA_VERSION).toBe(1));
});

describe('ipc contract', () => {
  it('defaults allowDuplicate to false', () => {
    expect(pickAndImportInput.parse({ mode: 'managed' })).toEqual({ mode: 'managed', allowDuplicate: false });
  });
  it('rejects empty path lists and unknown modes', () => {
    expect(importPathsInput.safeParse({ paths: [], mode: 'managed' }).success).toBe(false);
    expect(importPathsInput.safeParse({ paths: ['/a.pdf'], mode: 'copy' }).success).toBe(false);
  });
  it('takes the collection an import files into: a uuid, null, or nothing', () => {
    const COLL = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    expect(pickAndImportInput.parse({ mode: 'managed', collectionId: COLL })).toEqual({ mode: 'managed', allowDuplicate: false, collectionId: COLL });
    expect(importPathsInput.parse({ paths: ['/a.pdf'], mode: 'linked', collectionId: null })).toEqual({
      paths: ['/a.pdf'], mode: 'linked', allowDuplicate: false, collectionId: null,
    });
    // Without a collection the key stays absent, so the importer sees "none", not a value.
    expect(importPathsInput.parse({ paths: ['/a.pdf'], mode: 'linked' })).not.toHaveProperty('collectionId');
    for (const bad of ['', 'not-a-uuid', 7, {}]) {
      expect(pickAndImportInput.safeParse({ mode: 'managed', collectionId: bad }).success, String(bad)).toBe(false);
      expect(importPathsInput.safeParse({ paths: ['/a.pdf'], mode: 'managed', collectionId: bad }).success, String(bad)).toBe(false);
    }
  });
  it('asks for items by id: 1 to 5,000 uuids', () => {
    const id = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    expect(getItemsInput.parse({ ids: [id] })).toEqual({ ids: [id] });
    expect(getItemsInput.safeParse({ ids: Array.from({ length: 5000 }, () => id) }).success).toBe(true);
    expect(getItemsInput.safeParse({ ids: Array.from({ length: 5001 }, () => id) }).success).toBe(false);
    expect(getItemsInput.safeParse({ ids: [] }).success).toBe(false);
    expect(getItemsInput.safeParse({ ids: ['not-a-uuid'] }).success).toBe(false);
    expect(getItemsInput.safeParse({}).success).toBe(false);
  });
  it('takes the reported command context strictly, with the library and selection counts (P-2)', () => {
    const ctx = { view: 'library', blocked: false, sidebar: 'shown', inspector: 'hidden', textSize: 13, libraryCount: 3, selectionCount: 2, selectionAvailable: 1, selectionRelinkable: 1 };
    expect(commandContextInput.parse(ctx)).toEqual(ctx);
    // The fatal screen reports neither pane.
    expect(commandContextInput.safeParse({ view: 'library', blocked: true, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0 }).success).toBe(true);
    for (const k of ['libraryCount', 'selectionCount', 'selectionAvailable', 'selectionRelinkable'] as const) {
      for (const bad of [-1, 1.5, 1_000_001, '1']) expect(commandContextInput.safeParse({ ...ctx, [k]: bad }).success, `${k} ${bad}`).toBe(false);
      const without: Record<string, unknown> = { ...ctx };
      delete without[k];
      expect(commandContextInput.safeParse(without).success, `${k} missing`).toBe(false);
    }
    expect(commandContextInput.safeParse({ ...ctx, inspector: 'open' }).success).toBe(false);
    expect(commandContextInput.safeParse({ ...ctx, extra: 1 }).success).toBe(false);
  });
  it('builds same-origin asset URLs', () => {
    expect(APP_ORIGIN).toBe('learn://app');
    expect(assetUrl('abc')).toBe('learn://app/asset/abc');
  });
  it('bounds item titles at 500 characters and collection names at 200', () => {
    const itemId = newId();
    expect(updateMetadataInput.parse({ itemId, title: `  ${'t'.repeat(300)}  ` }).title).toBe('t'.repeat(300));
    expect(updateMetadataInput.safeParse({ itemId, title: 't'.repeat(500) }).success).toBe(true);
    expect(updateMetadataInput.safeParse({ itemId, title: 't'.repeat(501) }).success).toBe(false);
    expect(updateMetadataInput.safeParse({ itemId, title: '   ' }).success).toBe(false);
    expect(createCollectionInput.safeParse({ name: 'n'.repeat(200) }).success).toBe(true);
    expect(createCollectionInput.safeParse({ name: 'n'.repeat(201) }).success).toBe(false);
  });
  it('NFC-normalizes collection and tag names (macOS input can arrive decomposed), then trims and bounds them', () => {
    const nfc = '선형대수';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(nameSchema.parse(`  ${nfd} `)).toBe(nfc);
    expect(createTagInput.parse({ name: nfd }).name).toBe(nfc);
    expect(createCollectionInput.parse({ name: nfd }).name).toBe(nfc);
    const id = newId();
    expect(renameTagInput.parse({ tagId: id, name: nfd }).name).toBe(nfc);
    expect(renameCollectionInput.parse({ collectionId: id, name: nfd }).name).toBe(nfc);
    // The 200-character bound applies to the normalized name: 200 syllables are 600 code units in NFD.
    const long = '가'.repeat(200);
    expect(nameSchema.parse(long.normalize('NFD'))).toBe(long);
    expect(nameSchema.safeParse('가'.repeat(201).normalize('NFD')).success).toBe(false);
  });
});

describe('copy shared across screens', () => {
  it('the video formats list never breaks inside (no breakable space; U+00A0 around each middot)', () => {
    expect(VIDEO_FORMATS.replace(/\u00a0/g, ' ')).toBe('MP4 · MOV · WebM');
    expect(VIDEO_FORMATS).not.toMatch(/[ \t]/);
  });
});
