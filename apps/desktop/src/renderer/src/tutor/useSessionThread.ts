import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionThread, ToolChip } from '@learn/domain';
import { api, ApiError, unwrap } from '../api';
import { keys } from '../data/queries';
import { useTutorTab } from './tutorStore';

/** An answer still coming, as the window heard it from its first notice: the text so far, the tools recorded and the one running. */
export interface LiveTurn {
  tutorMessageId: string;
  text: string;
  tools: ToolChip[];
  running: ToolChip | null;
  /** The pages read_pdf_pages returned in this turn so far: a cite of one is drawn as a chip at once, any other as checking (J41). */
  verifiedSoFar: Set<number>;
}

/** How often a session is read again while its answer comes and this window did not hear it from the start (main saves it every 2 s). */
export const JOINED_READ_MS = 2000;

/**
 * The live answer while it is the truth about its message: the stored message is not there yet, or is still coming and holds no more
 * than the live one (its text, saved every 2 s, is a beginning of the live text; its tools a part of the live ones). Null once the
 * stored message ended (the thread read again at the end has its sources — P-16), and when the live one missed the beginning: a window
 * reloaded mid-answer draws the stored text, read again every 2 s, until the answer ends.
 */
export function liveOver(thread: SessionThread | null, live: LiveTurn | null): LiveTurn | null {
  if (live === null || thread === null) return live;
  const stored = thread.messages.find((m) => m.id === live.tutorMessageId);
  if (stored === undefined) return live;
  if (stored.status !== 'streaming') return null;
  return live.text.startsWith(stored.text) && live.tools.length >= stored.tools.length ? live : null;
}

/** Whether a notice of `messageId` may start a live answer: the stored thread has nothing of it yet (else this window joined late). */
export function startsLive(thread: SessionThread | undefined, messageId: string): boolean {
  const stored = thread?.messages.find((m) => m.id === messageId);
  return stored === undefined || (stored.text === '' && stored.tools.length === 0);
}

/** An answer of the thread is coming and the window has no live one over it: it joined that answer late. */
const joinedLate = (thread: SessionThread | undefined, live: LiveTurn | null): boolean =>
  thread !== undefined && liveOver(thread, live) === null && thread.messages.some((m) => m.role === 'tutor' && m.status === 'streaming');

/**
 * The tab's session as stored (sessions:get, `['sessions', 'get', id]`) and its answer still coming as the window hears it (P-16). The
 * stored thread is read again when an answer ends and when main says a session changed (data/queries.ts); while an answer this window
 * joined late is coming, every 2 s. A session that is gone (deleted, its item in the trash) leaves the tab on a new empty session.
 */
export function useSessionThread(conversationId: string | null): { thread: SessionThread | null; live: LiveTurn | null } {
  const stored = useTutorTab((s) => s.live);
  const setLive = useTutorTab((s) => s.setLive);
  const setConversation = useTutorTab((s) => s.setConversation);
  const read = useQuery({
    queryKey: keys.sessionThread(conversationId ?? ''),
    queryFn: () => unwrap(api().sessions.get({ conversationId: conversationId! })),
    enabled: conversationId !== null,
    refetchInterval: (q) => (joinedLate(q.state.data, stored) ? JOINED_READ_MS : false),
  });
  const thread = conversationId === null ? null : (read.data ?? null);
  const live = liveOver(thread, stored);
  // The stored thread took over: the live answer goes (an ended one, or one that missed its beginning).
  useEffect(() => {
    if (stored !== null && thread !== null && live === null) setLive(null);
  }, [stored, thread, live, setLive]);
  const gone = read.error instanceof ApiError && read.error.code === 'NOT_FOUND';
  useEffect(() => {
    if (gone) setConversation(null);
  }, [gone, setConversation]);
  return { thread, live };
}
