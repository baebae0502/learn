import type { RecentSessions, SessionSummary } from '@learn/domain';
import { api, unwrap } from '../../api';
import { keys } from '../../data/queries';
import { queryClient } from '../../data/query-client';
import { revealInspector } from '../../shell/useInspector';
import { chooseInspectorMode } from '../../shell/inspectorMode';
import { t } from '../../strings';
import { showToast, showUndoToast } from '../../ui/toasts';
import { readerScopes, type ReaderScope } from '../../viewers/readerScope';
import { renamedTitle, useSessionEdit } from './sessionEdit';

const words = t.tutor.sessions;

/** The open tabs whose tutor shows this session. */
function tabsShowing(conversationId: string): ReaderScope[] {
  return readerScopes.ids().flatMap((id) => {
    const scope = readerScopes.peek(id);
    return scope?.tutor.getState().conversationId === conversationId ? [scope] : [];
  });
}

/** A renamed session in the lists already read, so its row says its name before main's notice has them read again. */
function putRenamed(renamed: SessionSummary): void {
  queryClient.setQueryData<SessionSummary[]>(keys.sessionsList(renamed.itemId), (list) => list?.map((s) => (s.id === renamed.id ? renamed : s)));
  queryClient.setQueryData<RecentSessions>(keys.sessionsRecent, (recent) =>
    recent && { groups: recent.groups.map((g) => ({ ...g, sessions: g.sessions.map((s) => (s.id === renamed.id ? renamed : s)) })) },
  );
}

/**
 * The tutor of the tab around a session row shows that session (spec 8.9): the right panel in its tutor mode, a folded one opened —
 * nothing is started (the composer's focus is what starts an agent).
 */
export function showSession(scope: ReaderScope, conversationId: string): void {
  scope.tutor.getState().setConversation(conversationId);
  chooseInspectorMode('tutor');
  revealInspector('tutor');
}

/** 이름 바꾸기 (spec 8.9): the row becomes its name field, its name selected. */
export function startRename(conversationId: string): void {
  useSessionEdit.getState().begin(conversationId);
}

/**
 * The name field is done: ↩ (refused while the name is over 200 characters), a click elsewhere (the name typed so far, or none if it
 * is too long). An emptied name is the first question again. A refused rename says so in a toast.
 */
export async function finishRename(session: SessionSummary, raw: string, how: 'enter' | 'blur'): Promise<void> {
  const edit = useSessionEdit.getState();
  if (edit.renaming !== session.id || edit.busy) return;
  const verdict = renamedTitle(raw, session);
  if (verdict === 'tooLong') {
    if (how === 'blur') edit.end(false);
    return;
  }
  if (verdict === 'unchanged') {
    edit.end(how === 'enter');
    return;
  }
  edit.setBusy(true);
  try {
    putRenamed(await unwrap(api().sessions.rename({ conversationId: session.id, title: verdict.title })));
  } catch (e) {
    showToast({ kind: 'error', title: words.renameFailed, body: e instanceof Error ? e.message : undefined, testId: 'session-rename-failed' });
  } finally {
    useSessionEdit.getState().end(how === 'enter');
  }
}

export function cancelRename(): void {
  const edit = useSessionEdit.getState();
  if (edit.renaming !== null && !edit.busy) edit.end(true);
}

/**
 * 세션 삭제 (spec 8.9): at once — main stops its answer first, if one is coming — with 실행 취소. A tab that showed it goes to a new
 * empty session, and comes back to it with 실행 취소 while it is still on that empty session. The focus moves to the row `next`.
 */
export async function deleteSession(conversationId: string, next: string | null = null): Promise<void> {
  // Read before the delete: main's notice of it may make a tab's own read of the session let it go first.
  const showed = tabsShowing(conversationId);
  try {
    await unwrap(api().sessions.delete({ conversationId }));
  } catch (e) {
    showToast({ kind: 'error', title: words.deleteFailed, body: e instanceof Error ? e.message : undefined, testId: 'session-delete-failed' });
    return;
  }
  for (const scope of showed) scope.tutor.getState().setConversation(null);
  if (next !== null) useSessionEdit.getState().focus(next);
  showUndoToast(
    words.deleted,
    async () => {
      await unwrap(api().sessions.restore({ conversationId }));
      for (const scope of showed) if (scope.tutor.getState().conversationId === null) scope.tutor.getState().setConversation(conversationId);
    },
    { testId: 'session-undo' },
  );
}
