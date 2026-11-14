import { useMemo } from 'react';
import { CircleAlert, MessageSquare } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../api';
import { keys } from '../../data/queries';
import { t } from '../../strings';
import { Button } from '../../ui/Button';
import { PaneEmpty } from '../../ui/PaneEmpty';
import { useNow } from '../../useNow';
import { useReaderScope } from '../../viewers/readerScope';
import { useTutorTab } from '../tutorStore';
import { showSession } from './sessionActions';
import { sessionGroups } from './sessionGroups';
import { SessionTree, type SessionGroupView } from './SessionRow';

const words = t.tutor.sessions;

/** sessions:list of an item, newest first: main's notices and an item's trash, restore and purge read it again (data/queries.ts). */
export const useItemSessions = (itemId: string) => useQuery({ queryKey: keys.sessionsList(itemId), queryFn: () => unwrap(api().sessions.list({ itemId })) });

/**
 * The reader sidebar's 세션 pane (spec 8.9, ⌥⌘5): this item's sessions by day, the one the tab's tutor shows selected. Selecting a row
 * shows its session in the tab's tutor (the right panel in its tutor mode). Until the list is read nothing is drawn; with none, the
 * empty state says where they come from; a read that failed says so, with 다시 시도.
 */
export function SessionsPane() {
  const scope = useReaderScope();
  const read = useItemSessions(scope.id);
  const current = useTutorTab((s) => s.conversationId);
  const now = useNow();
  const groups = useMemo<SessionGroupView[]>(() => sessionGroups(read.data ?? [], now).map((g) => ({ key: g.label, ...g })), [read.data, now]);
  if (read.data === undefined && read.isError) {
    return (
      <PaneEmpty
        icon={CircleAlert}
        title={words.listFailed}
        top
        testId="reader-sessions-failed"
        action={
          <Button size="small" isPending={read.isFetching} onPress={() => void read.refetch()} testId="reader-sessions-retry">
            {t.common.retry}
          </Button>
        }
      >
        {read.error.message}
      </PaneEmpty>
    );
  }
  if (read.data === undefined) return <div className="reader-sessions-wait" data-testid="reader-sessions-wait" />;
  if (groups.length === 0) {
    return (
      <PaneEmpty icon={MessageSquare} title={words.emptyTitle} top testId="reader-sessions-empty">
        {words.emptyText}
      </PaneEmpty>
    );
  }
  return <SessionTree groups={groups} mode="select" selectedId={current} onSelect={(s, how) => showSession(scope, s.id, how)} className="nav-list session-tree reader-sessions" testId="reader-sessions" />;
}
