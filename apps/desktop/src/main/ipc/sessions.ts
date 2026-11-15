import { Channels, emptyInput, nowIso, sessionIdInput, sessionsListInput, sessionsRenameInput, type SessionsChanged } from '@learn/domain';
import type { ConversationsRepository } from '@learn/db';
import { broadcast } from '../events';
import type { Handle, IpcDeps } from './register';

/** The tutor's sessions (spec 12): reads, and the changes the session list makes — each announced to every window once it is written. */
export function registerSessionsIpc(handle: Handle, deps: IpcDeps): void {
  const repo = (): ConversationsRepository => deps.getContext().conversations;
  /** A change the repository made (it refuses one that changes nothing): its item goes with the notice. */
  const announce = (r: ConversationsRepository, reason: SessionsChanged['reason'], conversationId: string): void => {
    const c = r.conversation(conversationId);
    if (c) broadcast('sessions:changed', { reason, itemIds: [c.itemId], conversationIds: [conversationId] });
  };

  handle(Channels.sessions.list, sessionsListInput, ({ itemId }) => repo().list(itemId));
  handle(Channels.sessions.recent, emptyInput, () => repo().recent());
  handle(Channels.sessions.get, sessionIdInput, ({ conversationId }) => repo().thread(conversationId));

  handle(Channels.sessions.rename, sessionsRenameInput, ({ conversationId, title }) => {
    const r = repo();
    const renamed = r.rename(conversationId, title);
    announce(r, 'renamed', conversationId);
    return renamed;
  });

  // A session whose answer is coming is stopped first (as 중지 stops it): no answer, and no 중지 for it, outlives the delete. Its
  // answer ends stopped, which 실행 취소 brings back with the session.
  handle(Channels.sessions.delete, sessionIdInput, ({ conversationId }) => {
    const r = repo();
    deps.tutor?.stopConversation(conversationId);
    r.remove(conversationId, nowIso());
    announce(r, 'deleted', conversationId);
  });

  handle(Channels.sessions.restore, sessionIdInput, ({ conversationId }) => {
    const r = repo();
    r.restore(conversationId);
    announce(r, 'restored', conversationId);
  });
}
