import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentsReport, ErrorCode, MessageStatus } from '@learn/domain';

/** A call to main that the test answers when it wants: the IPC's order, and what crosses it, are the test's. */
interface Pending<T> { input: unknown; settle(r: T): void }
type Res = { ok: true; data: unknown } | { ok: false; code: string; message: string; retryable: boolean };
const asks: Array<Pending<Res>> = [];
const reads: Array<Pending<Res>> = [];
const resends: Array<Pending<Res>> = [];
const regrounds: Array<Pending<Res>> = [];
const later = <T,>(list: Array<Pending<T>>) => (input: unknown) => new Promise<T>((settle) => list.push({ input, settle }));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: () => ({
    tutor: { ask: later(asks), agents: later([]), stop: async () => ({ ok: true, data: undefined }), resend: later(resends), reground: later(regrounds) },
    sessions: { get: later(reads) },
    translation: { cancel: async () => ({ ok: true, data: undefined }) },
  }),
}));

const { regroundAnswer, resendAnswer, sendQuestion, waitEnded } = await import('./useSend');
const { hearTurn } = await import('./useTurnEvents');
const { answerComingIn } = await import('./useSessionThread');
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

// Whatever a test left on its way ends, so the next one starts with no question of the tab on its way: a wait let go of, the rest refused.
afterEach(async () => {
  tab().setWaiting(null);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // A status read that fails otherwise is tried again: NOT_FOUND ends it at once.
  for (let round = 0; round < 3; round += 1) {
    for (const p of reads) p.settle(fail('NOT_FOUND'));
    for (const list of [asks, resends, regrounds]) for (const p of list) p.settle(fail('CANCELLED'));
    await drain();
  }
  warn.mockRestore();
});

beforeEach(() => {
  asks.length = 0;
  reads.length = 0;
  resends.length = 0;
  regrounds.length = 0;
  tab().setConversation(null);
  tab().setWaiting(null);
  tab().setSent(null);
  tab().setNotice(null);
  tab().setAttached(null);
  tab().setLive(null);
  for (const k of Object.keys(tab().drafts)) tab().setDraft(k, '');
  scope.tutor.setState({ droppedAnswers: [] });
  scope.reader.getState().setPdf({ ready: true, pagesCount: 10, pageNumber: 1 });
  queryClient.setQueryData(keys.tutorAgents, READY);
  queryClient.setQueryData(keys.prefs, { tutor: { consent: { version: 1, at: '2026-11-14T00:00:00.000Z' }, agent: 'fake' } });
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

describe('the passage attached in the composer goes with the question, and the answer is heard from its start', () => {
  const passage = {
    anchor: { kind: 'pdf', revisionId: '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11', precision: 'span', pageIndex: 0, quads: [[0, 1, 1, 1, 0, 0, 1, 0]], coordinateSpace: 'pdf-user-space', text: { quote: { exact: '구간', prefix: '', suffix: '' } } },
    text: '구간', pageIndex: 0, multipage: false, long: false, margin: null,
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

  it('a new session\'s first question: the tab moved to the session main made before tutor:ask answered — still heard from its start', async () => {
    const sent = sendQuestion(scope, '이 구간은?', 'fake');
    await drain();
    // main's notice that the session was made comes before its answer to tutor:ask, and moves the tab there.
    tab().setConversation(MADE.conversationId);
    asks[0]!.settle(ok(MADE));
    await sent;
    expect(tab().conversationId).toBe(MADE.conversationId);
    expect(tab().live).toMatchObject({ tutorMessageId: MADE.tutorMessageId, fromStart: true });
  });

  it('a failure before any answer whose notice came before tutor:ask\'s answer leaves no answer coming', async () => {
    const sent = sendQuestion(scope, '이 구간은?', 'fake');
    await drain();
    tab().setConversation(MADE.conversationId);
    hearTurn({ conversationId: MADE.conversationId, messageId: MADE.tutorMessageId, kind: 'failed', phase: 'before', code: 'AGENT_START_FAILED' });
    asks[0]!.settle(ok(MADE));
    await sent;
    expect(tab().live).toBeNull();
    expect(answerComingIn(scope)).toBeNull();
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

describe('a failure before any answer gives the question back to the composer that sent it (spec 8.8) — nothing is sent again by itself', () => {
  const passage = {
    anchor: { kind: 'pdf', revisionId: '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11', precision: 'span', pageIndex: 0, quads: [[0, 1, 1, 1, 0, 0, 1, 0]], coordinateSpace: 'pdf-user-space', text: { quote: { exact: '구간', prefix: '', suffix: '' } } },
    text: '구간', pageIndex: 0, multipage: false, long: false, margin: null,
  } as const;
  const CONV = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const failedBefore = (conversationId: string, messageId: string, code: ErrorCode = 'AGENT_EXITED') =>
    hearTurn({ conversationId, messageId, kind: 'failed', phase: 'before', code });
  /** The tab's composer holds `text` (and the passage), and ↩ sends it; main writes the rows (a new session's notice first). */
  async function sent(text: string, made = MADE): Promise<void> {
    const key = draftKey(tab().conversationId, ITEM);
    tab().setDraft(key, text);
    tab().setAttached(passage as never);
    const going = sendQuestion(scope, text, 'fake');
    await drain();
    if (tab().conversationId === null) tab().setConversation(made.conversationId); // main's notice that the session was made
    asks.at(-1)!.settle(ok(made));
    await going;
  }

  it('a new session\'s first question: its text and chip back, the tab on a new empty session again, the notice there, the focus asked', async () => {
    const focus = tab().composerFocus;
    await sent('첫 질문');
    expect(tab().drafts).toEqual({});
    expect(tab().attached).toBeNull();
    expect(tab().sent).toMatchObject({ kind: 'question', tutorMessageId: MADE.tutorMessageId, from: null, text: '첫 질문' });
    failedBefore(MADE.conversationId, MADE.tutorMessageId);
    expect(tab().conversationId).toBeNull();
    expect(tab().drafts).toEqual({ [draftKey(null, ITEM)]: '첫 질문' });
    expect(tab().attached).toBe(passage);
    expect(tab().notice).toEqual({ code: 'AGENT_EXITED', afterSeq: 0, agent: 'fake' });
    expect(tab().alert).toMatchObject({ code: 'AGENT_EXITED', phase: 'before', agent: 'fake' });
    expect(tab().composerFocus).toBe(focus + 1);
    expect(tab().sent).toBeNull();
    expect(tab().live).toBeNull();
    expect(asks).toHaveLength(1); // never sent again by itself
  });

  it('a question in a session: back under that session\'s draft, the notice after the turn before it', async () => {
    tab().setConversation(CONV);
    queryClient.setQueryData(keys.sessionThread(CONV), { session: {}, item: {}, messages: [{ id: 'q1', seq: 1, role: 'user', status: 'complete' }, { id: 'a1', seq: 2, role: 'tutor', status: 'complete' }] });
    const made = { conversationId: CONV, userMessageId: 'u-2', tutorMessageId: 't-2' };
    await sent('둘째 질문', made);
    expect(tab().drafts).toEqual({});
    failedBefore(CONV, made.tutorMessageId, 'AGENT_TIMEOUT');
    expect(tab().conversationId).toBe(CONV);
    expect(tab().drafts).toEqual({ [CONV]: '둘째 질문' });
    expect(tab().notice).toEqual({ code: 'AGENT_TIMEOUT', afterSeq: 2, agent: 'fake' });
  });

  it('a failure whose notice beats tutor:ask\'s answer: nothing leaves the composer, and the tab stays on its new empty session', async () => {
    tab().setDraft(draftKey(null, ITEM), '첫 질문');
    tab().setAttached(passage as never);
    const going = sendQuestion(scope, '첫 질문', 'fake');
    await drain();
    tab().setConversation(MADE.conversationId);
    failedBefore(MADE.conversationId, MADE.tutorMessageId, 'AGENT_START_FAILED');
    asks[0]!.settle(ok(MADE));
    await going;
    expect(tab().conversationId).toBeNull();
    expect(tab().drafts).toEqual({ [draftKey(null, ITEM)]: '첫 질문' });
    expect(tab().attached).toBe(passage);
    expect(tab().notice).toMatchObject({ code: 'AGENT_START_FAILED', afterSeq: 0 });
    expect(tab().live).toBeNull();
    expect(tab().sent).toBeNull();
  });

  it('a send main refused (offline, the agent not ready, its login): the text and chip stay, the notice stands, the focus is asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const focus = tab().composerFocus;
    tab().setDraft(draftKey(null, ITEM), '질문');
    tab().setAttached(passage as never);
    const going = sendQuestion(scope, '질문', 'fake');
    await drain();
    asks[0]!.settle(fail('OFFLINE'));
    await going;
    expect(tab().drafts).toEqual({ [draftKey(null, ITEM)]: '질문' });
    expect(tab().attached).toBe(passage);
    expect(tab().notice).toEqual({ code: 'OFFLINE', afterSeq: 0, agent: 'fake' });
    expect(tab().composerFocus).toBe(focus + 1);
    // The next send takes the notice away (and is the one send: nothing went by itself).
    const again = sendQuestion(scope, '질문', 'fake');
    expect(tab().notice).toBeNull();
    await drain();
    expect(asks).toHaveLength(2);
    asks[1]!.settle(ok(MADE));
    await again;
    warn.mockRestore();
  });

  it('only the tab that sent it: another tab on the same session gets nothing back and no notice', async () => {
    const other = readerScopes.get('2b7e1c4d-5f6a-4b8c-9d0e-1f2a3b4c5d6e');
    other.tutor.getState().setConversation(MADE.conversationId);
    await sent('첫 질문');
    failedBefore(MADE.conversationId, MADE.tutorMessageId);
    expect(other.tutor.getState().notice).toBeNull();
    expect(other.tutor.getState().drafts).toEqual({});
    expect(tab().notice).not.toBeNull();
    other.tutor.getState().setConversation(null);
  });

  it('a failure after the answer began gives nothing back: the failed answer says it, the tab says it once', async () => {
    await sent('첫 질문');
    hearTurn({ conversationId: MADE.conversationId, messageId: MADE.tutorMessageId, kind: 'text', append: '부분' });
    hearTurn({ conversationId: MADE.conversationId, messageId: MADE.tutorMessageId, kind: 'failed', phase: 'during', code: 'AGENT_EXITED' });
    expect(tab().drafts).toEqual({});
    expect(tab().notice).toBeNull();
    expect(tab().sent).toBeNull();
    expect(tab().conversationId).toBe(MADE.conversationId);
    expect(tab().alert).toMatchObject({ code: 'AGENT_EXITED', phase: 'during' });
  });
});

describe('다시 보내기 and 원문 근거로 다시 묻기', () => {
  const CONV = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  beforeEach(() => {
    tab().setConversation(CONV);
    queryClient.setQueryData(keys.sessionThread(CONV), { session: {}, item: {}, messages: [{ id: 'q1', seq: 1, role: 'user', status: 'complete' }, { id: 'a1', seq: 2, role: 'tutor', status: 'failed' }] });
  });

  it('a resend asks main with the reader as it is; the new answer is heard from its start', async () => {
    const going = resendAnswer(scope, 'a1');
    await drain();
    expect(resends[0]!.input).toMatchObject({ messageId: 'a1', reader: { pageIndex: 0, pageCount: 10 } });
    resends[0]!.settle(ok({ tutorMessageId: 'a2' }));
    await going;
    expect(tab().live).toMatchObject({ tutorMessageId: 'a2', fromStart: true });
    expect(tab().retryRefused).toBeNull();
  });

  it('a resend main refused (nothing changed): that code over the failed answer, the composer as it was', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tab().setDraft(CONV, '쓰던 글');
    const going = resendAnswer(scope, 'a1');
    await drain();
    resends[0]!.settle(fail('OFFLINE'));
    await going;
    expect(tab().retryRefused).toEqual({ messageId: 'a1', code: 'OFFLINE' });
    expect(tab().alert).toMatchObject({ code: 'OFFLINE', phase: 'during' });
    expect(tab().drafts).toEqual({ [CONV]: '쓰던 글' });
    expect(tab().notice).toBeNull();
    // A second press is the one that goes: the refusal's words go with it.
    const again = resendAnswer(scope, 'a1');
    expect(tab().retryRefused).toBeNull();
    await drain();
    resends[1]!.settle(ok({ tutorMessageId: 'a2' }));
    await again;
    warn.mockRestore();
  });

  it('one press at a time: a second while the first is on its way does nothing', async () => {
    const going = resendAnswer(scope, 'a1');
    void resendAnswer(scope, 'a1');
    await drain();
    expect(resends).toHaveLength(1);
    resends[0]!.settle(ok({ tutorMessageId: 'a2' }));
    await going;
  });

  it('a reground that fails before its answer: only its turn goes, nothing comes back to the composer, its title stands', async () => {
    const focus = tab().composerFocus;
    const going = regroundAnswer(scope, 'a1');
    await drain();
    expect(regrounds[0]!.input).toMatchObject({ messageId: 'a1', reader: { pageCount: 10 } });
    regrounds[0]!.settle(ok({ userMessageId: 'u-2', tutorMessageId: 't-2' }));
    await going;
    expect(tab().live).toMatchObject({ tutorMessageId: 't-2', fromStart: true });
    hearTurn({ conversationId: CONV, messageId: 't-2', kind: 'failed', phase: 'before', code: 'AGENT_EXITED' });
    expect(tab().notice).toEqual({ code: 'AGENT_EXITED', afterSeq: 2, agent: 'fake', reground: true });
    expect(tab().drafts).toEqual({});
    expect(tab().composerFocus).toBe(focus);
    expect(tab().conversationId).toBe(CONV);
  });

  it('a reground main refused: its title stands after the answer, nothing else', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const going = regroundAnswer(scope, 'a1');
    await drain();
    regrounds[0]!.settle(fail('AGENT_NOT_READY'));
    await going;
    expect(tab().notice).toEqual({ code: 'AGENT_NOT_READY', afterSeq: 2, agent: 'fake', reground: true });
    warn.mockRestore();
  });
});
