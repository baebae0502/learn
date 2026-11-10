import { describe, expect, it } from 'vitest';
import {
  sentScopeSchema, sessionsRenameInput, tutorAgentsInput, tutorAskInput, tutorEnvelope, tutorViewInput, tutorRetryInput, DEFAULT_TUTOR_PREFS, tutorPrefsSchema,
} from '../src/tutor';

const ID = '3f2b8c1e-5d4a-4b6f-8a9e-1c2d3e4f5a6b';
const ID2 = '4f2b8c1e-5d4a-4b6f-8a9e-1c2d3e4f5a6b';
const reader = { pageIndex: 0, pageCount: 10, outline: [], outlineComplete: true, outlineTotal: 0 };
const ask = { itemId: ID, conversationId: null, text: 'Why?', selection: null, reader };
const span = {
  kind: 'pdf', revisionId: ID2, precision: 'span', pageIndex: 0, coordinateSpace: 'pdf-user-space',
  quads: [[0, 0, 1, 0, 1, 1, 0, 1]], text: { quote: { exact: 'x', prefix: '', suffix: '' } },
};

describe('tutorAskInput', () => {
  it('takes the smallest input and a 300-entry outline', () => {
    expect(tutorAskInput.safeParse(ask).success).toBe(true);
    const outline = Array.from({ length: 300 }, (_, i) => ({ title: `t${i}`, depth: 0, pageIndex: i }));
    expect(tutorAskInput.safeParse({ ...ask, reader: { ...reader, outline, outlineTotal: 300 } }).success).toBe(true);
  });
  it('takes a selection with a span anchor', () => {
    const r = tutorAskInput.safeParse({ ...ask, selection: { anchor: span, text: 'x' } });
    expect(r.error?.issues).toBeUndefined();
    expect(r.success).toBe(true);
  });
  it('rejects what is out of bounds', () => {
    expect(tutorAskInput.safeParse({ ...ask, text: 'a'.repeat(8001) }).success).toBe(false);
    expect(tutorAskInput.safeParse({ ...ask, selection: { anchor: span, text: 'a'.repeat(4001) } }).success).toBe(false);
    const outline = Array.from({ length: 301 }, () => ({ title: 't', depth: 0, pageIndex: 0 }));
    expect(tutorAskInput.safeParse({ ...ask, reader: { ...reader, outline } }).success).toBe(false);
    expect(tutorAskInput.safeParse({ ...ask, reader: { ...reader, pageCount: 0 } }).success).toBe(false);
    expect(tutorAskInput.safeParse({ ...ask, extra: 1 }).success).toBe(false);
    expect(tutorAskInput.safeParse({ ...ask, selection: { anchor: { ...span, precision: 'region' }, text: 'x' } }).success).toBe(false);
  });
  it('turns an NFD question into NFC', () => {
    const r = tutorAskInput.parse({ ...ask, text: '한글'.normalize('NFD') });
    expect(r.text).toBe('한글'.normalize('NFC'));
  });
});

describe('the other inputs', () => {
  it('recheck names its agent', () => {
    expect(tutorAgentsInput.safeParse({ mode: 'recheck' }).success).toBe(false);
    expect(tutorAgentsInput.safeParse({ mode: 'recheck', agent: 'claude' }).success).toBe(true);
    expect(tutorAgentsInput.safeParse({ mode: 'cached' }).success).toBe(true);
  });
  it('the view is an object that holds the view or null', () => {
    expect(tutorViewInput.safeParse({ view: null }).success).toBe(true);
    expect(tutorViewInput.safeParse({ view: { itemId: ID, conversationId: null } }).success).toBe(true);
    expect(tutorViewInput.safeParse(null).success).toBe(false);
    expect(tutorViewInput.safeParse({}).success).toBe(false);
    expect(tutorViewInput.safeParse({ itemId: ID }).success).toBe(false);
  });
  it('rename takes null and refuses blank', () => {
    expect(sessionsRenameInput.safeParse({ conversationId: ID, title: null }).success).toBe(true);
    expect(sessionsRenameInput.safeParse({ conversationId: ID, title: '  ' }).success).toBe(false);
  });
  it('retry carries the reader', () => {
    expect(tutorRetryInput.safeParse({ messageId: ID, reader }).success).toBe(true);
    expect(tutorRetryInput.safeParse({ messageId: ID }).success).toBe(false);
  });
  it('the sent scope takes selection 0 or 1', () => {
    expect(sentScopeSchema.safeParse({ selection: 1, replayedTurns: 0, preamble: false }).success).toBe(true);
    expect(sentScopeSchema.safeParse({ selection: 2, replayedTurns: 0, preamble: false }).success).toBe(false);
  });
  it('prefs.tutor refuses another consent version', () => {
    expect(tutorPrefsSchema.safeParse(DEFAULT_TUTOR_PREFS).success).toBe(true);
    expect(tutorPrefsSchema.safeParse({ consent: { version: 2, at: 'x' }, agent: null }).success).toBe(false);
  });
});

describe('tutorEnvelope', () => {
  const env = {
    tool: 'get_outline', item: { id: ID, title: 'T' }, outline: [{ title: 'a', depth: 0, page: 1, cite: '[[p1]]' }],
    returned: 1, total: 1, limited: false, next: null, provenance: { revisionId: ID2, sha256: 'ab', parser: 'pdf-text-1' },
  };
  it('takes its shape and refuses unknown fields', () => {
    expect(tutorEnvelope.safeParse(env).success).toBe(true);
    expect(tutorEnvelope.safeParse({ ...env, extra: 1 }).success).toBe(false);
    expect(tutorEnvelope.safeParse({ ...env, provenance: { ...env.provenance, extra: 1 } }).success).toBe(false);
  });
  it('holds exactly the part its tool returns', () => {
    const page = { anchor: { kind: 'pdf', revisionId: ID2, precision: 'page', pageIndex: 0 }, label: 'p1', cite: '[[p1]]', text: 'x', duplicate: false, truncated: false };
    const { outline: _o, ...base } = env;
    expect(tutorEnvelope.safeParse({ ...base, tool: 'read_pdf_pages', pages: [page] }).success).toBe(true);
    expect(tutorEnvelope.safeParse({ ...env, pages: [page] }).success).toBe(false);
    expect(tutorEnvelope.safeParse({ ...base, tool: 'read_pdf_pages' }).success).toBe(false);
    expect(tutorEnvelope.safeParse({ ...env, tool: 'get_context' }).success).toBe(false);
  });
});
