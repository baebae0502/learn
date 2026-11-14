import type { RecentSessions, SessionSummary } from '@learn/domain';
import { api, unwrap } from '../../api';
import { keys } from '../../data/queries';
import { queryClient } from '../../data/query-client';
import { settingKey } from '../../data/saveSetting';
import { inspectorContentMin, revealFoldsSidebar } from '../../shell/layout';
import { chooseInspectorMode, readerMode } from '../../shell/inspectorMode';
import { revealInspector } from '../../shell/useInspector';
import { useShell } from '../../state/shell-store';
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

/** The reader's right panel on 튜터: written only when it is not already (a selection is no settings change). */
export function chooseTutorMode(): void {
  if (readerMode(queryClient.getQueryData(settingKey('reader.inspectorMode'))) !== 'tutor') chooseInspectorMode('tutor');
}

/** Showing a folded right panel would fold the sidebar now (a narrow window: the side opened last wins, spec 8.10). */
function revealWouldFoldSidebar(): boolean {
  const { sidebar, inspector, tutorWidth, view } = useShell.getState();
  return revealFoldsSidebar({ sidebar, inspector, tutorWidth }, innerWidth, inspectorContentMin(view.kind), 'tutor');
}

/**
 * The tutor of the tab around a session row shows that session (spec 8.9), the right panel in its tutor mode — nothing is started
 * (the composer's focus is what starts an agent). A folded panel opens, unless that would fold the sidebar under the arrow keys that
 * are browsing it: then the panel stays folded and the user opens it the usual way. A press (a click) that opens it there folds the
 * sidebar, and the focus goes to the conversation column.
 */
export function showSession(scope: ReaderScope, conversationId: string, how: 'browse' | 'press'): void {
  scope.tutor.getState().setConversation(conversationId);
  chooseTutorMode();
  const folds = revealWouldFoldSidebar();
  if (folds && how === 'browse') return;
  revealInspector('tutor');
  if (folds) scope.tutor.getState().setLogFocus(true);
}

/** What opening a session in its item's tab needs from the window. */
export interface OpenSessionDeps {
  /** item.open's edit check: `run` runs once an open 정보 편집 is left (saved, or nothing to save), never when it is refused. */
  afterEditing(run: () => void): void;
  scope(itemId: string): ReaderScope;
  openTab(itemId: string): void;
  /** The right panel on 튜터, a folded one opened. */
  showTutor(): void;
}

/**
 * A library session row (spec 8.9): its item's tab, the way 열기 opens it, on that session with the tutor shown — all of it behind
 * the edit check, so a refused edit leaves nothing behind (no tab, no scope, no mode, no reveal).
 */
export const openSessionWith =
  (d: OpenSessionDeps) =>
  (itemId: string, conversationId: string): void =>
    d.afterEditing(() => {
      d.scope(itemId).tutor.getState().setConversation(conversationId);
      d.openTab(itemId);
      d.showTutor();
    });

/** 이름 바꾸기 (spec 8.9): the row becomes its name field, its name selected. */
export function startRename(conversationId: string): void {
  useSessionEdit.getState().begin(conversationId);
}

/** The edit of this row ends, if it is still the one being made (another may have begun while a rename was on its way). */
function endOwnEdit(conversationId: string, refocus: boolean): void {
  const edit = useSessionEdit.getState();
  if (edit.renaming === conversationId) edit.end(refocus);
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
    endOwnEdit(session.id, how === 'enter');
  }
}

export function cancelRename(): void {
  const edit = useSessionEdit.getState();
  if (edit.renaming !== null && !edit.busy) edit.end(true);
}

/** The row the focus goes to after a delete, while the focus is still where the delete left it (`stillHere`). */
export interface NextRow {
  id: string;
  stillHere(): boolean;
}

/**
 * 세션 삭제 (spec 8.9): at once — main stops its answer first, if one is coming — with 실행 취소. A tab that showed it goes to a new
 * empty session, and comes back to it with 실행 취소 while it is still on that empty session. The focus moves to the row `next` once
 * the delete is done, unless the user has put it somewhere else meanwhile.
 */
export async function deleteSession(conversationId: string, next: NextRow | null = null): Promise<void> {
  // Read before the delete: main's notice of it may make a tab's own read of the session let it go first.
  const showed = tabsShowing(conversationId);
  try {
    await unwrap(api().sessions.delete({ conversationId }));
  } catch (e) {
    showToast({ kind: 'error', title: words.deleteFailed, body: e instanceof Error ? e.message : undefined, testId: 'session-delete-failed' });
    return;
  }
  for (const scope of showed) scope.tutor.getState().setConversation(null);
  if (next !== null && next.stillHere()) useSessionEdit.getState().focus(next.id);
  showUndoToast(
    words.deleted,
    async () => {
      await unwrap(api().sessions.restore({ conversationId }));
      for (const scope of showed) if (scope.tutor.getState().conversationId === null) scope.tutor.getState().setConversation(conversationId);
    },
    { testId: 'session-undo' },
  );
}
