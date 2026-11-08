import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkWorkerMessage, workerMessage } from './messages';

const jobId = randomUUID();
const at = (nextPage: number, pages: number | null) => ({ jobId, nextPage, pages });
const texts = (n: number, len = 3) => Array.from({ length: n }, () => 'x'.repeat(len));

describe('worker messages', () => {
  it('takes the sequence opened, pages from 0, pages from 20, done', () => {
    expect(checkWorkerMessage({ type: 'opened', jobId, pages: 30 }, at(0, null))).toEqual({ type: 'opened', jobId, pages: 30 });
    expect(checkWorkerMessage({ type: 'pages', jobId, from: 0, texts: texts(20) }, at(0, 30))?.type).toBe('pages');
    expect(checkWorkerMessage({ type: 'pages', jobId, from: 20, texts: texts(10) }, at(20, 30))?.type).toBe('pages');
    expect(checkWorkerMessage({ type: 'done', jobId, pages: 30, truncated: false }, at(30, 30))?.type).toBe('done');
    expect(checkWorkerMessage({ type: 'failed', jobId, reason: 'locked' }, at(0, null))?.type).toBe('failed');
  });
  it('turns away what does not fit', () => {
    const bad = (raw: unknown, where = at(0, 30)) => expect(checkWorkerMessage(raw, where)).toBeNull();
    bad({ type: 'opened', jobId: randomUUID(), pages: 3 }, at(0, null));
    bad({ type: 'opened', jobId, pages: 3 }, at(0, 3));
    bad({ type: 'pages', jobId, from: 0, texts: texts(1) }, at(0, null));
    bad({ type: 'pages', jobId, from: 2, texts: texts(1) });
    bad({ type: 'pages', jobId, from: 0, texts: texts(21), }, at(0, 100));
    bad({ type: 'pages', jobId, from: 0, texts: [] });
    bad({ type: 'pages', jobId, from: 0, texts: ['x'.repeat(100_001)] });
    bad({ type: 'pages', jobId, from: 0, texts: Array.from({ length: 7 }, () => 'x'.repeat(100_000)) }, at(0, 100));
    bad({ type: 'pages', jobId, from: 29, texts: texts(2) }, at(29, 30));
    bad({ type: 'pages', jobId, from: 0, texts: texts(1), extra: 1 });
    bad({ type: 'failed', jobId, reason: 'bogus' });
    bad({ type: 'done', jobId, pages: 3, truncated: false }, at(0, null));
    bad({ type: 'nope', jobId });
    bad('opened');
    bad(null);
  });
  it('lets a batch reach the batch limit plus one page and no more', () => {
    const ok = Array.from({ length: 6 }, () => 'x'.repeat(100_000)); // 600,000
    expect(checkWorkerMessage({ type: 'pages', jobId, from: 0, texts: ok }, at(0, 100))).not.toBeNull();
    expect(checkWorkerMessage({ type: 'pages', jobId, from: 0, texts: [...ok.slice(0, 5), 'x'.repeat(100_000), 'y'] }, at(0, 100))).toBeNull();
  });
  it('is a strict schema', () => {
    expect(workerMessage.safeParse({ type: 'done', jobId, pages: 1, truncated: true }).success).toBe(true);
    expect(workerMessage.safeParse({ type: 'done', jobId, pages: 1, truncated: true, x: 1 }).success).toBe(false);
  });
});
