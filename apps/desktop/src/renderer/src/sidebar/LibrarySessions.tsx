import { useQuery } from '@tanstack/react-query';
import type { RecentSessions, SessionSummary } from '@learn/domain';
import { api, unwrap } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { runCommand } from '../commands/registry';
import { keys } from '../data/queries';
import { t } from '../strings';
import { showSession } from '../tutor/sessions/sessionActions';
import { SessionTree, type SessionGroupView } from '../tutor/sessions/SessionRow';
import { readerScopes } from '../viewers/readerScope';

/** sessions:recent: the items talked about last and their newest sessions; main's notices read it again (data/queries.ts). */
export const useRecentSessions = () => useQuery({ queryKey: keys.sessionsRecent, queryFn: () => unwrap(api().sessions.recent()) });

/** The section's groups: one an item, its line a label, its sessions under it. */
export const recentGroups = (recent: RecentSessions | undefined): SessionGroupView[] =>
  (recent?.groups ?? []).filter((g) => g.sessions.length > 0).map((g) => ({ key: g.item.id, label: g.item.title, item: true, sessions: g.sessions }));

/**
 * The library sidebar's 세션 section (T1a spec 8.9; the approved mockup's place, under the collections): the five items talked about
 * last, each with its three newest sessions. A row opens its item in a reader tab the way 열기 does (an open edit asked first) with
 * that session in the tab's tutor; its menu is the reader's. Drawn only while there is a session.
 */
export function LibrarySessions({ groups }: { groups: readonly SessionGroupView[] }) {
  const { env } = useCommands();
  const open = (s: SessionSummary) => {
    if (!runCommand('item.open', env, { itemIds: [s.itemId] })) return;
    showSession(readerScopes.get(s.itemId), s.id);
  };
  return (
    <div className="library-sessions" data-testid="library-sessions">
      <div className="section-label" aria-hidden="true">
        {t.tutor.sessions.libraryHeading}
      </div>
      <SessionTree groups={groups} mode="open" onOpen={open} className="nav-list session-tree" testId="library-session-tree" />
    </div>
  );
}
