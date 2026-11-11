import { useCallback, useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import { citationCopyText, verifiedPages, type AgentId, type MessageView, type SourceChip } from '@learn/domain';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { useCopyFeedback } from '../ui/useCopyFeedback';
import { AnswerText } from './AnswerText';
import { CitationChip, type CiteState } from './CitationChip';
import { SentScope } from './SentScope';
import { ToolChips } from './ToolChips';
import type { LiveTurn } from './useSessionThread';

const { answer: words } = t.tutor;

/** What a chip needs from the reader of this tab: the document's revision, its page count, and the jump to a page (0-based). */
export interface CiteTarget {
  revisionId: string | null;
  pageCount: number;
  go(pageIndex: number): void;
}

/** A stored source's chip: it goes where its anchor's revision is the document open here, else it says that revision is gone. */
const sourceState = (s: SourceChip, target: CiteTarget): CiteState =>
  s.anchorId !== null && s.pageIndex !== null && s.revisionId === target.revisionId ? { kind: 'go', onPress: () => target.go(s.pageIndex!) } : { kind: 'lost' };

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
 * the sent-scope line at its right end.
 */
export function UserBubble({ message, answer, itemTitle, agent, target }: { message: MessageView; answer: MessageView | null; itemTitle: string; agent: AgentId; target: CiteTarget }) {
  const attached = message.attached;
  return (
    <div className="tutor-msg user" data-testid="tutor-question">
      <div className="bubble">
        {attached !== null && (
          <div className="tutor-quote">
            <span className="q">{attached.quote ?? ''}</span>
            {attached.pageIndex !== null && <CitationChip pageIndex={attached.pageIndex} state={sourceState(attached, target)} />}
          </div>
        )}
        <p>{message.text}</p>
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
 * The tutor's turn (design-spec 2.6): the tool chips over it, the answer on the left in --fill-hover (full width while it comes), then
 * copy, the line of how it ended and — in a session of several agents — whose answer it is. While `live` (the answer coming, heard from
 * its start) a cite of a page this turn read is a chip at once, any other "확인 중"; once it ended, the stored sources decide (P-16).
 */
export function TutorBubble({ message, live, mixed, target }: { message: MessageView; live: LiveTurn | null; mixed: boolean; target: CiteTarget }) {
  const streaming = live !== null || message.status === 'streaming';
  const text = live?.text ?? message.text;
  const storedVerified = useMemo(() => verifiedPages(message.tools), [message.tools]);
  const verified = live?.verifiedSoFar ?? storedVerified;
  const sources = message.sources;
  const cite = useCallback(
    (p: number) => {
      if (streaming) return <CitationChip pageIndex={p} state={verified.has(p) ? { kind: 'go', onPress: () => target.go(p) } : { kind: 'checking' }} />;
      const source = sources.find((s) => s.pageIndex === p);
      return <CitationChip pageIndex={p} state={source ? sourceState(source, target) : { kind: 'none', outside: target.pageCount > 0 && p >= target.pageCount }} />;
    },
    [streaming, verified, sources, target],
  );
  const end = endLine(message);
  const by = mixed && message.agent !== null ? t.tutor.agentName(message.agent) : null;
  return (
    <div className={cx('tutor-msg tutor', streaming && 'is-streaming')} data-testid="tutor-answer" data-status={streaming ? 'streaming' : message.status}>
      <ToolChips tools={live?.tools ?? message.tools} running={live?.running ?? null} />
      {text !== '' && (
        <div className="body" data-testid="tutor-answer-text">
          <AnswerText text={text} streaming={streaming} cite={cite} />
        </div>
      )}
      {!streaming && (text !== '' || end !== null || by !== null) && (
        <div className="tutor-foot-row">
          {text !== '' && <CopyAnswer message={message} />}
          {end !== null && (
            <span className="t-footnote c-secondary tutor-ended" data-testid="tutor-ended">
              {end}
            </span>
          )}
          {by !== null && <span className="t-footnote c-tertiary tutor-by">{by}</span>}
        </div>
      )}
    </div>
  );
}
