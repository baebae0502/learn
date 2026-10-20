import { describe, expect, it } from 'vitest';
import {
  APP_ORIGIN, ANCHOR_SCHEMA_VERSION, LearnError, assetUrl, fail, failureFrom, importPathsInput, newId, nowIso, ok,
  pickAndImportInput, sourceAnchor, toLearnError,
} from '../src/index';
import { IpcChannels } from '../src/ipc-channels';

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
  it('builds same-origin asset URLs', () => {
    expect(APP_ORIGIN).toBe('learn://app');
    expect(assetUrl('abc')).toBe('learn://app/asset/abc');
  });
  it('uses namespaced channel names (legacy)', () => {
    expect(Object.values(IpcChannels).every((c) => /^(app|library):[a-zA-Z]+$/.test(c))).toBe(true);
  });
});
