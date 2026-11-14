import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Check, Copy } from 'lucide-react';
import { citationCopyText, verifiedPages, type AgentId, type ErrorCode, type MessageView, type SourceChip } from '@learn/domain';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { perfMarkLatest } from '../ui/perfMarks';
import { useCopyFeedback } from '../ui/useCopyFeedback';
import { useReaderScope } from '../viewers/readerScope';
import { AnswerText } from './AnswerText';
import { CitationChip, type CiteState } from './CitationChip';
import { answerCheck, unverifiedForm } from './failureCopy';
import { SentScope } from './SentScope';
import { ToolChipRow } from './ToolChipRow';
import { TurnFailure } from './TurnFailure';
import { UnverifiedNotice } from './UnverifiedNotice';
import { regroundAnswer, resendAnswer } from './useSend';
import type { LiveTurn } from './useSessionThread';

const { answer: words } = t.tutor;

/**
 * What a chip needs from the reader of this tab: the document's revision, its page count (0 while not known: knownPageCount), the jump to
 * a page (0-based) that makes the pressed chip (`key`, sending the reader into `revisionId`) the current one, and which chip is ringed as
 * current.
 */
export interface CiteTarget {
  revisionId: string | null;
  pageCount: number;
  go(pageIndex: number, key: string, revisionId: string | null): void;
  current: string | null;
}

/** A stored source's chip: it goes where its anchor's revision is the document open here, else it says that revision is gone. */
const sourceState = (s: SourceChip, target: CiteTarget, key: string): CiteState =>
  s.anchorId !== null && s.pageIndex !== null && s.revisionId === target.revisionId ? { kind: 'go', onPress: () => target.go(s.pageIndex!, key, s.revisionId) } : { kind: 'lost' };

/** The one line of how an answer ended, under it (spec 13 "답 아래"); a failure is its own notice. */
function endLine(m: MessageView): string | null {
  if (m.status === 'streaming' || m.status === 'failed') return null;
  if (m.stopReason === 'max_tokens' || m.stopReason === 'too_long') return words.cut;
  if (m.stopReason === 'max_turn_requests') return words.steps;
  if (m.stopReason === 'refusal') return words.refused;
  if (m.status === 'stopped' || m.stopReason === 'cancelled') return words.stopped;
  return null;
}

/**
 * The user's turn (design-spec 2.6): on the right in the accent wash, the passage it carried on top (two lines, its page's chip), then
 * the sent-scope line at its right end. `shown`: the words the bubble says when they are not the stored text (a 원문 근거 요청 says
 * which pages to read first, in the user's words; its stored text is the agent's instruction).
 */
export function UserBubble({ message, answer, itemTitle, agent, target, shown }: { message: MessageView; answer: MessageView | null; itemTitle: string; agent: AgentId; target: CiteTarget; shown?: string }) {
  const attached = message.attached;
  return (
    <div className="tutor-msg user" data-testid="tutor-question">
      <div className="bubble">
        {attached !== null && (
          <div className="tutor-quote">
            <span className="q">{attached.quote ?? ''}</span>
            {attached.pageIndex !== null && (
              <CitationChip pageIndex={attached.pageIndex} state={sourceState(attached, target, `${message.id}:attached`)} current={target.current === `${message.id}:attached`} />
            )}
          </div>
        )}
        <p>{shown ?? message.text}</p>
      </div>
      <SentScope question={message} answer={answer} itemTitle={itemTitle} agent={agent} />
    </div>
  );
}

/** Copies the answer with its cites as "(42쪽)" and "(출처 없음)" (spec 8.3); the tooltip says 복사했습니다 for 1.5 s. */
function CopyAnswer({ message }: { message: MessageView }) {
  const { copied, copy } = useCopyFeedback('tutor');
  const verified = new Set(message.sources.flatMap((s) => (s.pageIndex === null ? [] : [s.pageIndex])));
  return (
    <>
      <IconButton icon={copied ? Check : Copy} size="small" label={copied ? words.copied : words.copy} tooltipOpen={copied} onPress={() => copy(citationCopyText(message.text, verified, t.tutor.copy))} testId="tutor-copy" />
      <span className="visually-hidden" role="status">
        {copied ? words.copied : ''}
      </span>
    </>
  );
}

/**
 * tutor-perf's end of a send (T1a spec 15): `learn:tutor:first-text-paint` at the start of the frame that paints the first text of an
 * answer heard as it came in. Once per answer; a stored one drawn again marks nothing.
 */
function useFirstTextPaint(coming: boolean, hasText: boolean): void {
  const marked = useRef(false);
  useLayoutEffect(() => {
    if (!coming || !hasText || marked.current) return;
    marked.current = true;
    requestAnimationFrame(() => perfMarkLatest('tutor:first-text-paint'));
  }, [coming, hasText]);
}

/**
 * The tutor's turn (design-spec 2.6): the tool chips over it, the answer on the left in --fill-hover (full width while it comes), then
 * copy, the line of how it ended and — in a session of several agents — whose answer it is. While `live` (the answer coming, heard from
 * its start) a cite of a page this turn read is a chip at once, any other "확인 중"; once it ended, the stored sources decide.
 * A failed answer keeps the part that came, cut with "…", and its failure's notice in place of the foot (mockup ?state=8): what
 * stopped it — or, after a resend main refused (`refused`), that refusal — and 다시 보내기. A finished answer that cited pages it did not
 * read says so under its foot (failureCopy.unverifiedForm). Only the thread's `last` answer can be resent or asked again from the source
 * (the turn goes at the end): under an older one either notice keeps its title alone. `agent`: the session's.
 */
export function TutorBubble({ message, live, mixed, target, agent, last = true, refused = null }: {
  message: MessageView;
  live: LiveTurn | null;
  mixed: boolean;
  target: CiteTarget;
  agent: AgentId;
  last?: boolean;
  refused?: ErrorCode | null;
}) {
  const scope = useReaderScope();
  const streaming = live !== null || message.status === 'streaming';
  const text = live?.text ?? message.text;
  useFirstTextPaint(live !== null, text !== '');
  const storedVerified = useMemo(() => verifiedPages(message.tools), [message.tools]);
  const verified = live?.verifiedSoFar ?? storedVerified;
  const sources = message.sources;
  const cite = useCallback(
    (p: number, ordinal: number) => {
      const key = `${message.id}:${ordinal}`;
      const current = target.current === key;
      if (streaming) return <CitationChip pageIndex={p} state={verified.has(p) ? { kind: 'go', onPress: () => target.go(p, key, target.revisionId) } : { kind: 'checking' }} current={current} />;
      const source = sources.find((s) => s.pageIndex === p);
      return <CitationChip pageIndex={p} state={source ? sourceState(source, target, key) : { kind: 'none', outside: target.pageCount > 0 && p >= target.pageCount }} current={current} />;
    },
    [message.id, streaming, verified, sources, target],
  );
  const end = endLine(message);
  const by = mixed && message.agent !== null ? t.tutor.agentName(message.agent) : null;
  const failed = !streaming && message.status === 'failed';
  const check = useMemo(() => (streaming || failed ? null : answerCheck(message, target.pageCount)), [streaming, failed, message, target.pageCount]);
  const unverified = unverifiedForm(streaming ? 'streaming' : message.status, check, last);
  const failure = failed ? (refused ?? (message.stopReason === 'interrupted' ? 'INTERRUPTED' : (message.errorCode ?? 'INTERNAL'))) : null;
  return (
    <div className={cx('tutor-msg tutor', streaming && 'is-streaming')} data-testid="tutor-answer" data-status={streaming ? 'streaming' : message.status}>
      <ToolChipRow tools={live?.tools ?? message.tools} running={live?.running ?? null} />
      {text !== '' && (
        <div className="body" data-testid="tutor-answer-text">
          <AnswerText text={text} streaming={streaming} cite={cite} end={failed ? <span className="tutor-cut" aria-hidden="true">{words.cutMark}</span> : undefined} />
        </div>
      )}
      {failure !== null ? (
        <TurnFailure code={failure} phase="during" agent={message.agent ?? agent} form={last ? 'full' : 'title'} onResend={() => void resendAnswer(scope, message.id)} />
      ) : (
        !streaming &&
        (text !== '' || end !== null || by !== null) && (
          <div className="tutor-foot-row">
            {text !== '' && <CopyAnswer message={message} />}
            {end !== null && (
              <span className="t-footnote c-secondary tutor-ended" data-testid="tutor-ended">
                {end}
              </span>
            )}
            {by !== null && <span className="t-footnote c-tertiary tutor-by">{by}</span>}
          </div>
        )
      )}
      {unverified !== 'none' && check !== null && (
        <UnverifiedNotice count={check.unverified.length} form={unverified} onReground={() => void regroundAnswer(scope, message.id)} />
      )}
    </div>
  );
}
