import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentsReport, MessageStatus } from '@learn/domain';

/** A call to main that the test answers when it wants: the IPC's order, and what crosses it, are the test's. */
interface Pending<T> { input: unknown; settle(r: T): void }
type Res = { ok: true; data: unknown } | { ok: false; code: string; message: string; retryable: boolean };
const asks: Array<Pending<Res>> = [];
const reads: Array<Pending<Res>> = [];
const later = <T,>(list: Array<Pending<T>>) => (input: unknown) => new Promise<T>((settle) => list.push({ input, settle }));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: () => ({
    tutor: { ask: later(asks), agents: later([]), stop: async () => ({ ok: true, data: undefined }) },
    sessions: { get: later(reads) },
    translation: { cancel: async () => ({ ok: true, data: undefined }) },
  }),
}));

const { sendQuestion, waitEnded } = await import('./useSend');
const { readerScopes } = await import('../viewers/readerScope');
const { queryClient } = await import('../data/query-client');
const { keys } = await import('../data/queries');
const { draftKey } = await import('./tutorStore');

const ITEM = '5d0c0c60-2b49-4d7b-9a3e-6b1c9d1f0a11';
const OTHER = { conversationId: '8a6e1c52-2f3b-4d0e-9a41-7b5c3e2d1f00', messageId: '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11' };
const MADE = { conversationId: '9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d', userMessageId: 'u-1', tutorMessageId: 't-1' };
const READY: AgentsReport = { agents: [], fake: { id: 'fake', name: 'fake', state: 'ready', cliVersion: null, adapterVersion: null, minimum: null, command: null, note: null } };
const ok = (data: unknown): Res => ({ ok: true, data });
const fail = (code: string): Res => ({ ok: false, code, message: '', retryable: false });
const thread = (status: MessageStatus) => ok({ session: {}, item: {}, messages: [{ id: OTHER.messageId, role: 'tutor', status }] });
/** Lets every settled promise run on. */
const drain = () => new Promise<void>((r) => setTimeout(r, 0));

const scope = readerScopes.get(ITEM);
const tab = () => scope.tutor.getState();
/** The new empty session's composer holds `text`; ↩ sends it, and main answers busy with another session's answer. */
async function waitingWith(text: string): Promise<{ sent: Promise<void> }> {
  tab().setDraft(draftKey(null, ITEM), text);
  const sent = sendQuestion(scope, text, 'fake');
  await drain();
  expect(asks).toHaveLength(1);
  asks[0]!.settle(ok({ busyWith: OTHER }));
  await drain();
  expect(tab().waiting).toMatchObject({ text, busyWith: OTHER });
  expect(reads).toHaveLength(1); // the other answer's status, read at once
  return { sent }; // (wrapped: an async function would wait for it)
}

beforeEach(() => {
  asks.length = 0;
  reads.length = 0;
  tab().setConversation(null);
  tab().setWaiting(null);
  scope.reader.getState().setPdf({ ready: true, pagesCount: 10, pageNumber: 1 });
  queryClient.setQueryData(keys.tutorAgents, READY);
});

describe('a question that waits for another session\'s answer is sent once that answer ends, and never lost', () => {
  it('waits while the read says the answer still comes; its end notice sends it, once', async () => {
    const { sent } = await waitingWith('다음 질문');
    reads[0]!.settle(thread('streaming'));
    await sent;
    expect(asks).toHaveLength(1);
    expect(tab().waiting).not.toBeNull();
    waitEnded(OTHER.messageId);
    await drain();
    expect(asks).toHaveLength(2);
    expect(asks[1]!.input).toMatchObject({ text: '다음 질문', conversationId: null });
    asks[1]!.settle(ok(MADE));
    await drain();
    expect(tab().waiting).toBeNull();
    expect(tab().conversationId).toBe(MADE.conversationId);
    expect(tab().drafts).toEqual({});
    // A second notice of the same end sends nothing more.
    waitEnded(OTHER.messageId);
    await drain();
    expect(asks).toHaveLength(2);
  });
  it('sends at once when the read finds that answer ended already', async () => {
    const { sent } = await waitingWith('다음 질문');
    reads[0]!.settle(thread('complete'));
    await drain();
    expect(asks).toHaveLength(2);
    asks[1]!.settle(ok(MADE));
    await sent;
    expect(tab().waiting).toBeNull();
  });
  it('keeps an end notice that comes while the read is on its way: when a stale read says it still comes, the question goes', async () => {
    const { sent } = await waitingWith('다음 질문');
    waitEnded(OTHER.messageId); // main ended the turn after it answered busy, and this notice crossed the read
    await drain();
    expect(asks).toHaveLength(1); // not twice: the read is still out
    reads[0]!.settle(thread('streaming'));
    await drain();
    expect(asks).toHaveLength(2);
    asks[1]!.settle(ok(MADE));
    await sent;
    expect(tab().waiting).toBeNull();
    waitEnded(OTHER.messageId);
    await drain();
    expect(asks).toHaveLength(2);
  });
  it('a session that is gone (deleted, or its only question failed before any answer) has no answer coming: sent at once', async () => {
    const { sent } = await waitingWith('다음 질문');
    reads[0]!.settle(fail('NOT_FOUND'));
    await drain();
    expect(reads).toHaveLength(1);
    expect(asks).toHaveLength(2);
    asks[1]!.settle(ok(MADE));
    await sent;
    expect(tab().waiting).toBeNull();
  });
  it('another failed read is tried once more; a second failure ends the wait and sends', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sent } = await waitingWith('다음 질문');
    reads[0]!.settle(fail('INTERNAL'));
    await drain();
    expect(reads).toHaveLength(2);
    expect(asks).toHaveLength(1);
    reads[1]!.settle(fail('INTERNAL'));
    await drain();
    expect(asks).toHaveLength(2);
    asks[1]!.settle(ok(MADE));
    await sent;
    expect(tab().waiting).toBeNull();
    warn.mockRestore();
  });
  it('a failed read whose retry says the answer still comes waits for the end notice', async () => {
    const { sent } = await waitingWith('다음 질문');
    reads[0]!.settle(fail('INTERNAL'));
    await drain();
    reads[1]!.settle(thread('streaming'));
    await sent;
    expect(asks).toHaveLength(1);
    waitEnded(OTHER.messageId);
    await drain();
    expect(asks).toHaveLength(2);
    asks[1]!.settle(ok(MADE));
    await drain();
    expect(tab().waiting).toBeNull();
  });
  it('보내지 않기 while the read is out: nothing is sent, whatever the read and the notices say', async () => {
    const { sent } = await waitingWith('다음 질문');
    tab().setWaiting(null);
    reads[0]!.settle(thread('complete'));
    await sent;
    waitEnded(OTHER.messageId);
    await drain();
    expect(asks).toHaveLength(1);
  });
});

describe('the passage attached in the composer goes with the question, and the answer is heard from its start (Task 19)', () => {
  const passage = {
    anchor: { kind: 'pdf', revisionId: '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11', precision: 'span', pageIndex: 0, quads: [[0, 1, 1, 1, 0, 0, 1, 0]], coordinateSpace: 'pdf-user-space', text: { quote: { exact: '구간', prefix: '', suffix: '' } } },
    text: '구간', pageIndex: 0, multipage: false, long: false, lineStart: 0,
  } as const;
  beforeEach(() => {
    tab().setAttached(passage as never);
    tab().setLive(null);
    scope.reader.getState().setOutline({ rows: [], flat: [], pages: new Map(), resolvedUpTo: 0 });
  });

  it('carries the chip and the outline as cached; its rows written, the chip goes and the tab hears the answer from its start', async () => {
    tab().setDraft(draftKey(null, ITEM), '이 구간은?');
    const sent = sendQuestion(scope, '이 구간은?', 'fake');
    await drain();
    expect(asks[0]!.input).toMatchObject({ selection: { anchor: passage.anchor, text: '구간' }, reader: { pageIndex: 0, pageCount: 10, outline: [], outlineComplete: true, outlineTotal: 0 } });
    expect(tab().attached).toBe(passage);
    asks[0]!.settle(ok(MADE));
    await sent;
    expect(tab().attached).toBeNull();
    expect(tab().live).toMatchObject({ tutorMessageId: MADE.tutorMessageId, text: '', fromStart: true });
  });

  it('keeps the chip when main refuses the question before any row, and while it waits for another session\'s answer', async () => {
    const sent = sendQuestion(scope, '이 구간은?', 'fake');
    await drain();
    asks[0]!.settle(fail('AGENT_NOT_READY'));
    await sent;
    expect(tab().attached).toBe(passage);
    expect(tab().live).toBeNull();
    asks.length = 0;
    await waitingWith('이 구간은?');
    expect(tab().attached).toBe(passage);
  });
});
