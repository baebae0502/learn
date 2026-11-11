import { useId, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, FlaskConical, Send } from 'lucide-react';
import { Button } from 'react-aria-components';
import type { AgentId, MessageView } from '@learn/domain';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { mergeToolChips } from './toolChips';

const { scope } = t.tutor;

/** The pages the answer read, as the list says them once its turn ended: "41–42쪽, 57쪽", or "없음". */
function pagesRead(answer: MessageView): string {
  const runs = mergeToolChips(answer.tools).flatMap((v) => (v.kind === 'read' ? [scope.pages(v.from + 1, v.to + 1)] : []));
  return runs.length === 0 ? scope.none : runs.join(', ');
}

/**
 * The sent-scope line under a question (spec 8.5, ADR-0013 1, J45): what went out — the selection, 0 or 1 — and what the agent was let
 * read — this one item. No memory count until there is one to count. Its name is the words it shows (label in name); the approved
 * sentence that says what they count is its description. A press opens the list: what was sent (the question or the
 * reground request, the selection's page, the earlier turns sent again), the item, the pages the answer read once it ended, the agent.
 */
export function SentScope({ question, answer, itemTitle, agent }: { question: MessageView; answer: MessageView | null; itemTitle: string; agent: AgentId }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const describedBy = useId();
  const n = question.sent?.selection ?? (question.attached === null ? 0 : 1);
  const replayed = question.sent?.replayedTurns ?? 0;
  const ended = answer !== null && answer.status !== 'streaming';
  const by = answer?.agent ?? agent;
  return (
    <div className="tutor-scope-row">
      <Button className="tutor-scope" aria-describedby={describedBy} aria-expanded={open} aria-controls={open ? listId : undefined} onPress={() => setOpen((o) => !o)} data-testid="sent-scope">
        <Icon icon={Send} size="sm" />
        <span className="num">{scope.selection(n)}</span>{' '}
        <span className="dot">·</span>{' '}
        <Icon icon={BookOpen} size="sm" />
        <span className="num">{scope.material}</span>
        <Icon icon={open ? ChevronUp : ChevronDown} size="xs" />
      </Button>
      <span id={describedBy} hidden>
        {scope.name(n)}
      </span>
      {open && (
        <dl className="tutor-scope-list" id={listId} data-testid="sent-scope-list">
          <dt>{scope.sent}</dt>
          <dd>
            <div>{question.kind === 'reground' ? scope.reground : scope.question}</div>
            {question.attached?.pageIndex != null && <div>{scope.selectionAt(question.attached.pageIndex + 1)}</div>}
            {replayed > 0 && <div>{scope.replayed(replayed)}</div>}
          </dd>
          <dt>{scope.open}</dt>
          <dd>{itemTitle}</dd>
          {ended && (
            <>
              <dt>{scope.read}</dt>
              <dd>{pagesRead(answer)}</dd>
            </>
          )}
          <dt>{scope.agent}</dt>
          <dd className="agent">
            {by === 'fake' && <Icon icon={FlaskConical} size="sm" />}
            {t.tutor.agentName(by)}
          </dd>
        </dl>
      )}
    </div>
  );
}
