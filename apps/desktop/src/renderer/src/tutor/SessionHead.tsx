import type { Ref } from 'react';
import type { SessionSummary } from '@learn/domain';
import { formatDate } from '../format';
import { useNow } from '../useNow';

/**
 * The session's head line at the top of the conversation (spec 8.2): when it started ("오늘 오전 9:31"), under its name once the user
 * renamed it — until then its name is its first question, right below.
 */
export function SessionHead({ session, ref }: { session: SessionSummary; ref?: Ref<HTMLDivElement> }) {
  const now = useNow();
  return (
    <div className="tutor-session-head" ref={ref} data-testid="tutor-session-head">
      {session.renamed && (
        <span className="t ellipsis" title={session.title}>
          {session.title}
        </span>
      )}
      <span className="m">{formatDate(session.createdAt, now)}</span>
    </div>
  );
}

/** The session's name: a row under the panel head, above the conversation, once it is scrolled past its head line (mockup .tu-sticky). */
export function StickyName({ title, shown, ref }: { title: string; shown: boolean; ref?: Ref<HTMLDivElement> }) {
  return (
    <div className="tutor-sticky" hidden={!shown} ref={ref} data-testid="tutor-sticky">
      <span className="ellipsis">{title}</span>
    </div>
  );
}
