import { LearnError, TUTOR_LIMITS, checkCitations, type ErrorCode, type StopReason, type TutorTurnEvent } from '@learn/domain';
import type { ConversationsRepository } from '@learn/db';
import { mainStrings } from '../strings';
import type { PromptOutcome, SessionUpdate } from './acp/client';
import { RpcError } from './acp/jsonrpc';
import { isLoginRequired } from './agents/isolation';
import { tutorLog } from './log';

export interface TurnInput {
  conversationId: string; tutorMessageId: string; userMessageId: string; revisionId: string; pageCount: number;
  blocks: Array<{ type: 'text'; text: string }>;
  /** What a failure before the answer does: a question or a reground drops its pair; a resend keeps the question and leaves a failed answer. */
  beforeAnswer: 'drop-pair' | 'keep-failed';
}

export interface TurnDeps {
  /** The backend's prompt for this ACP session. */
  prompt(blocks: TurnInput['blocks'], on: (u: SessionUpdate) => void): Promise<PromptOutcome>;
  /** Cancel and kill: 'always' after a lockdown, 'if-not-ended' after a stop, a timeout or the length limit. */
  interrupt(kill: 'always' | 'if-not-ended'): void;
  repo: Pick<ConversationsRepository, 'saveText' | 'finishTurn' | 'dropBeforeAnswer' | 'toolReads'>;
  emit(e: TutorTurnEvent): void;
  timers: { setTimer(fn: () => void, ms: number): unknown; clearTimer(id: unknown): void };
  now(): string;
  timeouts: { firstUpdateMs: number; betweenMs: number; turnMs: number };
  stopRequested(): boolean;
  /** The app is quitting: the turn writes and announces nothing, and the row stays streaming for the next start to mend. */
  shuttingDown(): boolean;
}

export type TurnEnd =
  | { phase: 'before'; code: ErrorCode; answered: false }
  | { phase: 'during' | 'end'; status: 'complete' | 'stopped' | 'failed'; code: ErrorCode | null; answered: boolean }
  | { phase: 'abandoned'; answered: boolean };

/** Claude's failure shapes (RESULTS 5.15): a lockdown first, then Learn's own codes, then -32000, then -32603 by its data, then by its message. */
export function classifyFailure(e: unknown, lockedDown: boolean): ErrorCode {
  if (lockedDown) return 'AGENT_LOCKDOWN';
  if (e instanceof LearnError) return e.code;
  if (isLoginRequired(e)) return 'AGENT_LOGIN';
  if (e instanceof RpcError && e.rpcCode === -32603 && typeof e.data === 'object' && e.data !== null && 'startupFailureReason' in e.data) return 'AGENT_START_FAILED';
  // A server_error, "process exited unexpectedly", -32002 "Resource not found" and any other error reply all mean the session is gone.
  return 'AGENT_EXITED';
}

/** Claude also streams its error message as an answer chunk before the error reply; the part at the end of the text that is that message goes. */
export function stripErrorTail(text: string, message: string): string {
  const trimmed = text.trimEnd();
  const bare = message.replace(/^Internal error: /, '');
  for (const m of [message, bare]) {
    if (m.trimEnd().length > 0 && trimmed.endsWith(m.trimEnd())) return trimmed.slice(0, trimmed.length - m.trimEnd().length).trimEnd();
  }
  return text;
}

type TurnEvent = TutorTurnEvent extends infer E ? (E extends unknown ? Omit<E, 'conversationId' | 'messageId'> : never) : never;

type Reason = 'lockdown' | 'timeout' | 'too-long' | 'stopped' | 'error' | 'ok';

export async function runTurn(d: TurnDeps, t: TurnInput): Promise<TurnEnd> {
  const ids = { conversationId: t.conversationId, messageId: t.tutorMessageId };
  const timerIds = new Set<unknown>();
  const arm = (fn: () => void, ms: number): unknown => { const id = d.timers.setTimer(fn, ms); timerIds.add(id); return id; };
  const disarm = (id: unknown): void => { if (id !== null) { d.timers.clearTimer(id); timerIds.delete(id); } };
  const emit = (e: TurnEvent): void => {
    if (!d.shuttingDown()) d.emit({ ...ids, ...e });
  };

  let text = '';
  let pending = '';
  let savedLen = 0;
  let anyUpdate = false;
  let toolSeen = false;
  let sawForeignTool = false;
  let timedOut = false;
  let failed = false;
  let saveFailed = false;
  let tooLong = false;
  let ended = false;
  let batchTimer: unknown = null;
  let saveTimer: unknown = null;
  let updateTimer: unknown = null;
  let turnTimer: unknown = null;

  const flush = (): void => {
    disarm(batchTimer); batchTimer = null;
    if (pending === '') return;
    const append = pending;
    pending = '';
    emit({ kind: 'text', append });
  };
  const save = (): void => {
    disarm(saveTimer); saveTimer = null;
    if (d.shuttingDown() || text.length === savedLen) return;
    try {
      d.repo.saveText(t.tutorMessageId, text, d.now());
      savedLen = text.length;
      saveFailed = false;
    } catch (e) {
      // A partial save is only a safety net; the end writes the text again and throws if the row is truly gone. One log line, then the next tick tries again.
      if (!saveFailed) tutorLog('save-failed', { code: e instanceof LearnError ? e.code : 'UNKNOWN' });
      saveFailed = true;
    }
  };
  const timeout = (): void => {
    // The first cause wins: a stop, a length cut or a lockdown already decided the end, and a clock in its grace must not change it.
    if (ended || timedOut || tooLong || sawForeignTool || d.stopRequested()) return;
    timedOut = true;
    d.interrupt('if-not-ended');
  };
  const restartUpdateClock = (ms: number): void => { disarm(updateTimer); updateTimer = arm(timeout, ms); };
  const clearAll = (): void => { for (const id of timerIds) d.timers.clearTimer(id); timerIds.clear(); };

  const on = (u: SessionUpdate): void => {
    if (ended) return;
    anyUpdate = true;
    restartUpdateClock(d.timeouts.betweenMs);
    if (u.kind === 'activity') return;
    if (u.kind === 'tool') {
      toolSeen = true;
      if (!u.learn && !sawForeignTool) { sawForeignTool = true; d.interrupt('always'); }
      return;
    }
    if (tooLong || sawForeignTool) return;
    const room = TUTOR_LIMITS.answerChars - text.length;
    const piece = u.text.length > room ? u.text.slice(0, room) : u.text;
    if (piece !== '') {
      text += piece;
      pending += piece;
      batchTimer ??= arm(() => { disarm(batchTimer); batchTimer = null; flush(); }, TUTOR_LIMITS.textBatchMs);
      if (text.length - savedLen >= TUTOR_LIMITS.saveEveryChars && !saveFailed) save();
      else saveTimer ??= arm(() => { save(); }, TUTOR_LIMITS.saveEveryMs);
    }
    if (piece.length < u.text.length) { tooLong = true; d.interrupt('if-not-ended'); }
  };

  let outcome: PromptOutcome | null = null;
  let failure: unknown = null;
  try {
    restartUpdateClock(d.timeouts.firstUpdateMs);
    turnTimer = arm(timeout, d.timeouts.turnMs);
    try { outcome = await d.prompt(t.blocks, on); } catch (e) { failure = e; failed = true; }
    ended = true;
    clearAll();
    batchTimer = saveTimer = updateTimer = turnTimer = null;

    // The app is quitting: nothing is written or announced, and the row stays streaming.
    if (d.shuttingDown()) return { phase: 'abandoned', answered: anyUpdate || outcome?.stopReason != null };

    const lockedDown = sawForeignTool || outcome?.lockdown === true;
    const reason: Reason = lockedDown ? 'lockdown' : timedOut ? 'timeout' : tooLong ? 'too-long'
      : d.stopRequested() || outcome?.stopReason === 'cancelled' ? 'stopped' : failed ? 'error' : 'ok';
    const failedCode: ErrorCode | null = reason === 'lockdown' ? 'AGENT_LOCKDOWN' : reason === 'timeout' ? 'AGENT_TIMEOUT' : reason === 'error' ? classifyFailure(failure, false) : null;

    if (failure instanceof RpcError && reason === 'error') {
      const kept = stripErrorTail(text, failure.message);
      // What was cut off the end is cut from the part not yet streamed too, so the error sentence is never sent out.
      pending = pending.slice(0, Math.max(0, pending.length - (text.length - kept.length)));
      text = kept;
    }

    const status = failedCode !== null ? 'failed' : reason === 'stopped' ? 'stopped' : 'complete';
    const stopReason: StopReason | null = reason === 'too-long' ? 'too_long' : reason === 'stopped' ? 'cancelled' : status === 'failed' ? null : outcome?.stopReason ?? null;
    const answered = anyUpdate || outcome?.stopReason != null;

    // Claude may have streamed nothing but its own error text: that is still a failure before any answer.
    if (status === 'failed' && reason !== 'lockdown' && !toolSeen && text === '') {
      if (t.beforeAnswer === 'drop-pair') {
        d.repo.dropBeforeAnswer(t.userMessageId, t.tutorMessageId);
        emit({ kind: 'failed', phase: 'before', code: failedCode! });
        return { phase: 'before', code: failedCode!, answered: false };
      }
      d.repo.finishTurn(t.tutorMessageId, { status: 'failed', text: '', stopReason: null, errorCode: failedCode, revisionId: t.revisionId, verified: [],
        model: outcome?.model ?? null, inputTokens: outcome?.inputTokens ?? null, outputTokens: outcome?.outputTokens ?? null }, d.now());
      emit({ kind: 'failed', phase: 'during', code: failedCode! });
      return { phase: 'during', status: 'failed', code: failedCode, answered: false };
    }

    flush();
    const check = checkCitations(text, d.repo.toolReads(t.tutorMessageId), t.pageCount);
    const verified = check.verified.map((pageIndex) => ({ pageIndex, label: mainStrings.tutor.pageLabel(pageIndex + 1) }));
    const sources = d.repo.finishTurn(t.tutorMessageId, {
      status, text, stopReason, errorCode: failedCode, revisionId: t.revisionId, verified,
      model: outcome?.model ?? null, inputTokens: outcome?.inputTokens ?? null, outputTokens: outcome?.outputTokens ?? null,
    }, d.now());
    if (status === 'failed') {
      emit({ kind: 'failed', phase: 'during', code: failedCode! });
      return { phase: 'during', status: 'failed', code: failedCode, answered: true };
    }
    emit({ kind: 'done', status, stopReason, sources });
    return { phase: 'end', status, code: null, answered };
  } finally {
    ended = true;
    clearAll();
  }
}
