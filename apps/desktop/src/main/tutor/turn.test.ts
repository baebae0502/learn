import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsRepository, type Db } from '@learn/db';
import { LearnError, TUTOR_LIMITS, TUTOR_TIMEOUTS, type TutorTurnEvent } from '@learn/domain';
import { freshDb, seedItem } from '../../../../../packages/db/test/fixtures';
import { RpcError } from './acp/jsonrpc';
import type { PromptOutcome, SessionUpdate } from './acp/client';
import { classifyFailure, runTurn, stripErrorTail, type TurnDeps, type TurnEnd, type TurnInput } from './turn';

vi.mock('./log', () => ({ tutorLog: vi.fn() }));

const NOW = '2026-11-10T09:31:00.000Z';
const SENT = { selection: 0, replayedTurns: 0, preamble: true } as const;
const BLOCKS = [{ type: 'text' as const, text: 'q' }];
const OK: PromptOutcome = { stopReason: 'end_turn', lockdown: false, model: 'm1', inputTokens: 5, outputTokens: 7 };
const text = (t: string): SessionUpdate => ({ kind: 'text', text: t });
const activity: SessionUpdate = { kind: 'activity' };
const learnTool: SessionUpdate = { kind: 'tool', call: { toolCallId: 't', title: null, kind: null, toolName: null, rawInput: null }, learn: true };
const foreignTool: SessionUpdate = { kind: 'tool', call: { toolCallId: 'b', title: 'Bash', kind: 'execute', toolName: null, rawInput: null }, learn: false };
/** A Learn tool call by its id: a second notice with the same id is an update of that call. */
const call = (id: string): SessionUpdate => ({ kind: 'tool', call: { toolCallId: id, title: null, kind: null, toolName: null, rawInput: null }, learn: true });

/** Timers that run only when the test advances them. */
function fakeTimers() {
  let clock = 0; let next = 1;
  const live = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => { const id = next++; live.set(id, { at: clock + ms, fn }); return id; },
    clearTimer: (id: unknown) => { live.delete(id as number); },
    advance(ms: number) {
      const to = clock + ms;
      for (;;) {
        const due = [...live.entries()].filter(([, t]) => t.at <= to).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        live.delete(due[0]); clock = due[1].at; due[1].fn();
      }
      clock = to;
    },
    count: () => live.size,
  };
}

let db: Db; let repo: ConversationsRepository; let seed: { itemId: string; revisionId: string };
beforeEach(() => { db = freshDb(); seed = seedItem(db); repo = new ConversationsRepository(db); });
afterEach(() => db.close());

function begin(beforeAnswer: TurnInput['beforeAnswer'] = 'drop-pair'): TurnInput {
  const t = repo.beginTurn({ conversationId: null, itemId: seed.itemId, revisionId: seed.revisionId, agent: 'fake', openedAtPage: 3,
    user: { kind: 'question', text: 'q', sent: SENT, attached: null }, now: NOW });
  return { conversationId: t.conversationId, tutorMessageId: t.tutorMessageId, userMessageId: t.userMessageId, revisionId: seed.revisionId, pageCount: 120, blocks: BLOCKS, beforeAnswer };
}

interface Rig { d: TurnDeps; t: ReturnType<typeof fakeTimers>; events: TutorTurnEvent[]; interrupts: string[]; spies: { saveText: ReturnType<typeof vi.spyOn>; finishTurn: ReturnType<typeof vi.spyOn>; dropBeforeAnswer: ReturnType<typeof vi.spyOn> } }
/** `script` runs inside the prompt: it feeds updates and returns how the prompt ends. */
function rig(script: (on: (u: SessionUpdate) => void, t: ReturnType<typeof fakeTimers>) => Promise<PromptOutcome>, o: { stop?: () => boolean; shutting?: () => boolean; timeouts?: Partial<TurnDeps['timeouts']> } = {}): Rig {
  const t = fakeTimers(); const events: TutorTurnEvent[] = []; const interrupts: string[] = [];
  const d: TurnDeps = {
    prompt: (_b, on) => script(on, t),
    interrupt: (k) => { interrupts.push(k); },
    repo,
    emit: (e) => events.push(e),
    timers: t, now: () => NOW,
    timeouts: { firstUpdateMs: TUTOR_TIMEOUTS.firstUpdateMs, betweenMs: TUTOR_TIMEOUTS.betweenMs, turnMs: TUTOR_TIMEOUTS.turnMs, ...o.timeouts },
    stopRequested: o.stop ?? (() => false),
    shuttingDown: o.shutting ?? (() => false),
  };
  return { d, t, events, interrupts, spies: { saveText: vi.spyOn(repo, 'saveText'), finishTurn: vi.spyOn(repo, 'finishTurn'), dropBeforeAnswer: vi.spyOn(repo, 'dropBeforeAnswer') } };
}
const row = (id: string) => repo.message(id)!;
const count = (sql: string) => db.prepare(sql).pluck().get() as number;
const appended = (e: TutorTurnEvent[]) => e.filter((x) => x.kind === 'text').map((x) => (x as { append: string }).append);
/** A promise the test settles by hand, so updates can be fed while the prompt is open. */
function gate<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const p = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; }

describe('classifyFailure and stripErrorTail', () => {
  it('classifies Claude\'s failure shapes (RESULTS 5.15), a lockdown first', () => {
    const rpc = (code: number, message: string, data?: unknown) => new RpcError(code, message, data);
    expect(classifyFailure(rpc(-32000, 'Authentication required'), false)).toBe('AGENT_LOGIN');
    expect(classifyFailure(rpc(-32603, 'Internal error: The Claude Agent process exited unexpectedly. Please start a new session.'), false)).toBe('AGENT_EXITED');
    expect(classifyFailure(rpc(-32002, 'Resource not found', { sessionId: 's' }), false)).toBe('AGENT_EXITED');
    expect(classifyFailure(rpc(-32603, 'Internal error: Temp directory …', { startupFailureReason: 'temp_dir_unusable' }), false)).toBe('AGENT_START_FAILED');
    expect(classifyFailure(rpc(-32603, 'Internal error: API Error: Connection refused …', { errorKind: 'server_error' }), false)).toBe('AGENT_EXITED');
    expect(classifyFailure(new LearnError('AGENT_PROTOCOL', 'x'), false)).toBe('AGENT_PROTOCOL');
    expect(classifyFailure(new LearnError('AGENT_EXITED', 'x'), true)).toBe('AGENT_LOCKDOWN');
    expect(classifyFailure(rpc(-32000, 'something else'), false)).toBe('AGENT_EXITED');
    expect(classifyFailure(new Error('boom'), false)).toBe('AGENT_EXITED');
  });
  it('drops the error text Claude streamed before its error reply (R3)', () => {
    const msg = 'Internal error: API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)';
    expect(stripErrorTail('Part of the answer. API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)\n', msg)).toBe('Part of the answer.');
    expect(stripErrorTail(`Answer ${msg}`, msg)).toBe('Answer');
    expect(stripErrorTail('An answer that ends normally.', msg)).toBe('An answer that ends normally.');
    expect(stripErrorTail('Answer. oops', 'oops \n')).toBe('Answer.');
  });
});

describe('runTurn', () => {
  it('streams a batch as one append, saves every two seconds and finishes with the full text', async () => {
    const t = begin();
    const g = gate<PromptOutcome>(); let on!: (u: SessionUpdate) => void;
    const r = rig(async (o) => { on = o; return g.p; });
    const run = runTurn(r.d, t);
    on(text('a')); on(text('b')); on(text('c'));
    expect(appended(r.events)).toEqual([]);
    r.t.advance(TUTOR_LIMITS.textBatchMs);
    expect(appended(r.events)).toEqual(['abc']);
    on(text('d'));
    r.t.advance(TUTOR_LIMITS.textBatchMs);
    expect(appended(r.events)).toEqual(['abc', 'd']);
    expect(row(t.tutorMessageId).text).toBe('');
    r.t.advance(TUTOR_LIMITS.saveEveryMs);
    expect(row(t.tutorMessageId)).toMatchObject({ text: 'abcd', status: 'streaming' });
    g.resolve(OK);
    expect(await run).toEqual({ phase: 'end', status: 'complete', code: null, answered: true });
    expect(row(t.tutorMessageId)).toMatchObject({ text: 'abcd', status: 'complete' });
    expect(r.events.at(-1)).toMatchObject({ kind: 'done', status: 'complete', stopReason: 'end_turn', sources: [], conversationId: t.conversationId, messageId: t.tutorMessageId });
    expect(r.t.count()).toBe(0);
    expect(db.prepare('SELECT model, input_tokens, output_tokens FROM messages WHERE id = ?').get(t.tutorMessageId)).toEqual({ model: 'm1', input_tokens: 5, output_tokens: 7 });
  });

  it('puts a paragraph break between text before a tool call and text after it, and only there', async () => {
    const t = begin();
    const g = gate<PromptOutcome>(); let on!: (u: SessionUpdate) => void;
    const r = rig(async (o) => { on = o; return g.p; });
    const run = runTurn(r.d, t);
    // A tool call before any text: nothing to keep apart.
    on(call('c1')); on(text('No outline; read the first pages.'));
    on(call('c2')); on(call('c3')); on(text('먼저 짚어 둘 점이 '));
    on(text('있습니다.'));
    // Text that already ends a paragraph gets no second break; one that ends a line gets the other half.
    on(text('\n\n')); on(call('c4')); on(text('셋째.'));
    on(text('\n')); on(call('c5')); on(text('넷째.'));
    r.t.advance(TUTOR_LIMITS.textBatchMs);
    g.resolve(OK);
    await run;
    const want = 'No outline; read the first pages.\n\n먼저 짚어 둘 점이 있습니다.\n\n셋째.\n\n넷째.';
    expect(row(t.tutorMessageId).text).toBe(want);
    // What streamed out is the same text: nothing dropped, the break sent with the text after the tool.
    expect(appended(r.events).join('')).toBe(want);
  });

  it('a late update of a tool call already announced puts no break in the text; only a new call does', async () => {
    const t = begin();
    const g = gate<PromptOutcome>(); let on!: (u: SessionUpdate) => void;
    const r = rig(async (o) => { on = o; return g.p; });
    const run = runTurn(r.d, t);
    on(text('Before.')); on(call('t1')); on(text('첫 문장은 '));
    on(call('t1')); // its completion, late: the answer is already being written
    on(text('이어집니다.'));
    on(call('t2')); on(text('새 문단.'));
    r.t.advance(TUTOR_LIMITS.textBatchMs);
    g.resolve(OK);
    await run;
    expect(row(t.tutorMessageId).text).toBe('Before.\n\n첫 문장은 이어집니다.\n\n새 문단.');
  });

  it('saves at once when 2,000 characters have come since the last save', async () => {
    const t = begin();
    const g = gate<PromptOutcome>(); let on!: (u: SessionUpdate) => void;
    const r = rig(async (o) => { on = o; return g.p; });
    const run = runTurn(r.d, t);
    on(text('x'.repeat(1999)));
    expect(r.spies.saveText).not.toHaveBeenCalled();
    on(text('y'));
    expect(r.spies.saveText).toHaveBeenCalledTimes(1);
    expect(row(t.tutorMessageId).text).toHaveLength(2000);
    g.resolve(OK); await run;
  });

  it('cuts the text at 100,000 characters, interrupts once and ends complete as too_long', async () => {
    const t = begin();
    const g = gate<PromptOutcome>(); let on!: (u: SessionUpdate) => void;
    const r = rig(async (o) => { on = o; return g.p; });
    const run = runTurn(r.d, t);
    on(text('x'.repeat(TUTOR_LIMITS.answerChars - 1)));
    on(text('yyyy')); on(text('zzzz'));
    expect(r.interrupts).toEqual(['if-not-ended']);
    g.resolve({ ...OK, stopReason: 'cancelled' });
    expect(await run).toEqual({ phase: 'end', status: 'complete', code: null, answered: true });
    const m = row(t.tutorMessageId);
    expect(m.text).toHaveLength(TUTOR_LIMITS.answerChars);
    expect(m.text.endsWith('xy')).toBe(true);
    expect(r.events.at(-1)).toMatchObject({ kind: 'done', status: 'complete', stopReason: 'too_long' });
  });

  describe('time limits', () => {
    it('fails before the answer when nothing comes in firstUpdateMs: a question drops its pair', async () => {
      const t = begin('drop-pair');
      const r = rig(async (_on, tm) => { tm.advance(90_000); return { ...OK, stopReason: 'cancelled' }; }, { timeouts: { firstUpdateMs: 90_000 } });
      expect(await runTurn(r.d, t)).toEqual({ phase: 'before', code: 'AGENT_TIMEOUT', answered: false });
      expect(r.interrupts).toEqual(['if-not-ended']);
      expect(count('SELECT COUNT(*) FROM messages')).toBe(0);
      expect(r.events).toEqual([{ conversationId: t.conversationId, messageId: t.tutorMessageId, kind: 'failed', phase: 'before', code: 'AGENT_TIMEOUT' }]);
      expect(r.t.count()).toBe(0);
    });
    it('keep-failed leaves the question and a failed answer row', async () => {
      const t = begin('keep-failed');
      const r = rig(async (_on, tm) => { tm.advance(90_000); return { ...OK, stopReason: 'cancelled' }; }, { timeouts: { firstUpdateMs: 90_000 } });
      expect(await runTurn(r.d, t)).toEqual({ phase: 'during', status: 'failed', code: 'AGENT_TIMEOUT', answered: false });
      expect(count('SELECT COUNT(*) FROM messages')).toBe(2);
      expect(row(t.tutorMessageId)).toMatchObject({ status: 'failed', errorCode: 'AGENT_TIMEOUT', text: '' });
      expect(r.events.at(-1)).toMatchObject({ kind: 'failed', phase: 'during', code: 'AGENT_TIMEOUT' });
    });
    it('counts only activity as no answer: a timeout then is still before the answer', async () => {
      const t = begin();
      const r = rig(async (on, tm) => { on(activity); tm.advance(180_000); return { ...OK, stopReason: 'cancelled' }; }, { timeouts: { betweenMs: 180_000 } });
      expect(await runTurn(r.d, t)).toEqual({ phase: 'before', code: 'AGENT_TIMEOUT', answered: false });
      expect(count('SELECT COUNT(*) FROM messages')).toBe(0);
    });
    it('restarts the between-updates clock on every update (positive control: 179 s apart never times out, 181 s does)', async () => {
      const t = begin();
      const ok = rig(async (on, tm) => { on(activity); for (let i = 0; i < 4; i += 1) { tm.advance(179_000); on(activity); } on(text('done')); return OK; });
      expect(await runTurn(ok.d, t)).toMatchObject({ phase: 'end', status: 'complete' });
      expect(ok.interrupts).toEqual([]);
      const t2 = begin();
      const late = rig(async (on, tm) => { on(text('part')); tm.advance(181_000); return { ...OK, stopReason: 'cancelled' }; });
      expect(await runTurn(late.d, t2)).toEqual({ phase: 'during', status: 'failed', code: 'AGENT_TIMEOUT', answered: true });
      expect(late.interrupts).toEqual(['if-not-ended']);
      expect(row(t2.tutorMessageId)).toMatchObject({ status: 'failed', text: 'part' });
    });
    it('times out the whole turn at turnMs however lively it is', async () => {
      const t = begin();
      const r = rig(async (on, tm) => { for (let i = 0; i < 6; i += 1) { on(text('.')); tm.advance(170_000); } return { ...OK, stopReason: 'cancelled' }; });
      expect(await runTurn(r.d, t)).toMatchObject({ phase: 'during', status: 'failed', code: 'AGENT_TIMEOUT' });
    });
  });

  it('keeps the text received when the process exits mid-answer', async () => {
    const t = begin();
    const r = rig(async (on) => { on(text('half an answer')); throw new LearnError('AGENT_EXITED', 'x'); });
    expect(await runTurn(r.d, t)).toEqual({ phase: 'during', status: 'failed', code: 'AGENT_EXITED', answered: true });
    expect(row(t.tutorMessageId)).toMatchObject({ status: 'failed', errorCode: 'AGENT_EXITED', text: 'half an answer' });
    expect(r.events.at(-1)).toMatchObject({ kind: 'failed', phase: 'during', code: 'AGENT_EXITED' });
  });

  describe('Claude\'s error text (R3)', () => {
    const msg = 'Internal error: API Error: Connection refused (ECONNREFUSED)';
    const err = () => new RpcError(-32603, msg, { errorKind: 'server_error' });
    it('is not in the saved text of an answer that ends with an error reply', async () => {
      const t = begin();
      const r = rig(async (on) => { on(text('Some answer. ')); on(text('API Error: Connection refused (ECONNREFUSED)')); throw err(); });
      expect(await runTurn(r.d, t)).toEqual({ phase: 'during', status: 'failed', code: 'AGENT_EXITED', answered: true });
      expect(row(t.tutorMessageId).text).toBe('Some answer.');
    });
    it('a turn that streamed only the error text is before the answer: drop-pair writes nothing', async () => {
      const t = begin('drop-pair');
      const r = rig(async (on) => { on(text(msg)); throw err(); });
      expect(await runTurn(r.d, t)).toEqual({ phase: 'before', code: 'AGENT_EXITED', answered: false });
      expect(count('SELECT COUNT(*) FROM messages')).toBe(0);
      expect(r.events.at(-1)).toMatchObject({ kind: 'failed', phase: 'before', code: 'AGENT_EXITED' });
    });
    it('keep-failed leaves an empty failed answer, still not answered', async () => {
      const t = begin('keep-failed');
      const r = rig(async (on) => { on(text(msg)); throw err(); });
      expect(await runTurn(r.d, t)).toEqual({ phase: 'during', status: 'failed', code: 'AGENT_EXITED', answered: false });
      expect(row(t.tutorMessageId)).toMatchObject({ status: 'failed', text: '' });
    });
    it('a Learn tool call in the same turn makes it an answer in progress (positive control)', async () => {
      const t = begin('drop-pair');
      const r = rig(async (on) => { on(learnTool); on(text(msg)); throw err(); });
      expect(await runTurn(r.d, t)).toEqual({ phase: 'during', status: 'failed', code: 'AGENT_EXITED', answered: true });
      expect(row(t.tutorMessageId)).toMatchObject({ status: 'failed', text: '' });
    });
  });

  it('a failure with no answer at all is not answered', async () => {
    const t = begin();
    const r = rig(async () => { throw new RpcError(-32000, 'Authentication required'); });
    expect(await runTurn(r.d, t)).toEqual({ phase: 'before', code: 'AGENT_LOGIN', answered: false });
  });

  it('a tool that is not Learn\'s interrupts at once and kills; the end is a lockdown whatever the prompt says', async () => {
    const t = begin();
    const g = gate<PromptOutcome>(); let on!: (u: SessionUpdate) => void;
    const r = rig(async (o) => { on = o; return g.p; });
    const run = runTurn(r.d, t);
    on(text('before ')); on(foreignTool);
    expect(r.interrupts).toEqual(['always']);
    on(foreignTool);
    expect(r.interrupts).toEqual(['always']);
    g.resolve({ ...OK, stopReason: 'cancelled' });
    expect(await run).toEqual({ phase: 'during', status: 'failed', code: 'AGENT_LOCKDOWN', answered: true });
    expect(row(t.tutorMessageId)).toMatchObject({ status: 'failed', errorCode: 'AGENT_LOCKDOWN', text: 'before ' });
  });

  it('a lockdown with nothing else is still during the answer, never dropped', async () => {
    const t = begin('drop-pair');
    const r = rig(async (on) => { on(foreignTool); throw new LearnError('AGENT_EXITED', 'x'); });
    expect(await runTurn(r.d, t)).toEqual({ phase: 'during', status: 'failed', code: 'AGENT_LOCKDOWN', answered: true });
    expect(row(t.tutorMessageId).status).toBe('failed');
  });

  it('a stop ends stopped with cancelled and keeps the text', async () => {
    const t = begin();
    const r = rig(async (on) => { on(text('so far')); return { ...OK, stopReason: 'cancelled' }; }, { stop: () => true });
    expect(await runTurn(r.d, t)).toEqual({ phase: 'end', status: 'stopped', code: null, answered: true });
    expect(row(t.tutorMessageId)).toMatchObject({ status: 'stopped', text: 'so far' });
    expect(r.events.at(-1)).toMatchObject({ kind: 'done', status: 'stopped', stopReason: 'cancelled' });
  });

  it('an unknown stop reason is a complete answer with none', async () => {
    const t = begin();
    const r = rig(async (on) => { on(text('a')); return { ...OK, stopReason: null }; });
    expect(await runTurn(r.d, t)).toMatchObject({ status: 'complete' });
    expect(r.events.at(-1)).toMatchObject({ kind: 'done', stopReason: null });
  });

  it('writes and announces nothing while the app quits, and the row stays streaming', async () => {
    const t = begin();
    let quitting = false;
    const r = rig(async (on, tm) => { on(text('abc')); quitting = true; tm.advance(5000); return { ...OK, stopReason: 'cancelled' }; }, { shutting: () => quitting });
    expect(await runTurn(r.d, t)).toEqual({ phase: 'abandoned', answered: true });
    expect(r.events).toEqual([]);
    expect(r.spies.saveText).not.toHaveBeenCalled();
    expect(r.spies.finishTurn).not.toHaveBeenCalled();
    expect(r.spies.dropBeforeAnswer).not.toHaveBeenCalled();
    expect(row(t.tutorMessageId)).toMatchObject({ status: 'streaming', text: '' });
    expect(r.t.count()).toBe(0);
  });

  it('checks the cite tokens against the pages read this turn when it ends', async () => {
    const t = begin();
    repo.addToolRead(t.tutorMessageId, { tool: 'read_pdf_pages', outcome: 'ok', revisionId: seed.revisionId, pageFrom: 41, pageTo: 42, duplicatePages: 0, chars: 10, errorCode: null, ms: 1 }, NOW);
    const r = rig(async (on) => { on(learnTool); on(text('A [[p42]] B [[p57]] C [[p999]]')); return OK; });
    await runTurn(r.d, t);
    expect(r.events.at(-1)).toMatchObject({ kind: 'done', sources: [{ pageIndex: 41, label: '42쪽' }] });
    expect(repo.thread(t.conversationId).messages[1]!.sources.map((s) => s.pageIndex)).toEqual([41]);
  });

  it('a stop pressed before a clock fires stays a stop, with the rows kept and no second interrupt', async () => {
    const t = begin('drop-pair');
    let stopped = false;
    const r = rig(async (_on, tm) => { tm.advance(88_000); stopped = true; tm.advance(5_000); return { ...OK, stopReason: 'cancelled' }; }, { stop: () => stopped, timeouts: { firstUpdateMs: 90_000 } });
    expect(await runTurn(r.d, t)).toEqual({ phase: 'end', status: 'stopped', code: null, answered: true });
    expect(r.interrupts).toEqual([]);
    expect(count('SELECT COUNT(*) FROM messages')).toBe(2);
    expect(row(t.tutorMessageId)).toMatchObject({ status: 'stopped', text: '' });
    expect(r.events.at(-1)).toMatchObject({ kind: 'done', status: 'stopped', stopReason: 'cancelled' });
  });

  it('a length cut stays too_long when the turn clock fires during its grace', async () => {
    const t = begin();
    const r = rig(async (on, tm) => { on(text('x'.repeat(TUTOR_LIMITS.answerChars + 1))); tm.advance(900_000); return { ...OK, stopReason: 'cancelled' }; });
    expect(await runTurn(r.d, t)).toEqual({ phase: 'end', status: 'complete', code: null, answered: true });
    expect(r.interrupts).toEqual(['if-not-ended']);
    expect(r.events.at(-1)).toMatchObject({ kind: 'done', stopReason: 'too_long' });
  });

  it('never streams the error sentence out on an error end', async () => {
    const msg = 'Internal error: API Error: Connection refused (ECONNREFUSED)';
    const t = begin();
    const r = rig(async (on) => { on(text('Some answer. ')); on(text('API Error: Connection refused (ECONNREFUSED)')); throw new RpcError(-32603, msg); });
    await runTurn(r.d, t);
    expect(appended(r.events).join('')).toBe('Some answer.');
  });

  it('ignores text after a lockdown', async () => {
    const t = begin();
    const r = rig(async (on, tm) => { on(text('a')); on(foreignTool); on(text('late')); tm.advance(5000); return OK; });
    await runTurn(r.d, t);
    expect(row(t.tutorMessageId)).toMatchObject({ text: 'a', status: 'failed' });
    expect(appended(r.events).join('')).toBe('a');
  });

  it('after a failed save tries again only at the next tick', async () => {
    const t = begin();
    const g = gate<PromptOutcome>(); let on!: (u: SessionUpdate) => void;
    const r = rig(async (o) => { on = o; return g.p; });
    r.spies.saveText.mockImplementation(() => { throw new LearnError('NOT_FOUND', 'x'); });
    const run = runTurn(r.d, t);
    on(text('x'.repeat(2000)));
    on(text('y')); on(text('z'));
    expect(r.spies.saveText).toHaveBeenCalledTimes(1);
    r.t.advance(TUTOR_LIMITS.saveEveryMs);
    expect(r.spies.saveText).toHaveBeenCalledTimes(2);
    r.spies.saveText.mockRestore();
    g.resolve(OK); await run;
  });

  it('keeps the model and tokens on a failed resend that streamed nothing', async () => {
    const t = begin('keep-failed');
    const r = rig(async (_on, tm) => { tm.advance(90_000); return OK; }, { timeouts: { firstUpdateMs: 90_000 } });
    await runTurn(r.d, t);
    expect(db.prepare('SELECT model, input_tokens FROM messages WHERE id = ?').get(t.tutorMessageId)).toEqual({ model: 'm1', input_tokens: 5 });
  });

  it('clears every timer on every end path', async () => {
    for (const how of ['ok', 'throw', 'lockdown'] as const) {
      const t = begin();
      const r = rig(async (on) => { on(text('x')); if (how === 'throw') throw new LearnError('AGENT_EXITED', 'x'); if (how === 'lockdown') on(foreignTool); return OK; });
      await runTurn(r.d, t);
      expect(r.t.count(), how).toBe(0);
    }
  });
});
