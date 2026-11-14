import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionThread, ToolChip } from '@learn/domain';
import { api, ApiError, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import type { ReaderScope } from '../viewers/readerScope';
import { useTutorTab } from './tutorStore';

/** An answer still coming, as the window heard it from its first notice: the text so far, the tools recorded and the one running. */
export interface LiveTurn {
  tutorMessageId: string;
  text: string;
  tools: ToolChip[];
  running: ToolChip | null;
  /** The pages read_pdf_pages returned in this turn so far: a cite of one is drawn as a chip at once, any other as checking. */
  verifiedSoFar: Set<number>;
  /**
   * The answer to this tab's own question (tutor:ask answered with its rows): heard from its start for certain. main's notices and its
   * answers to the window's reads travel apart, so a read of the session can bring what the notices have not brought yet.
   */
  fromStart?: true;
}

/** How often a session is read again while its answer comes and this window did not hear it from the start (main saves it every 2 s). */
export const JOINED_READ_MS = 2000;

/**
 * The live answer while it is the truth about its message: the stored message is not there yet, or is still coming and agrees with
 * the live one (one text begins the other; its tools a part of the live ones) — or the live one answers this tab's own question, which
 * a read that came ahead of the notices never replaces. Null once the stored message ended (the thread read again at the end has its
 * sources), and when the live one missed the beginning: a window reloaded mid-answer draws the stored text, read again every 2 s, until
 * the answer ends.
 */
export function liveOver(thread: SessionThread | null, live: LiveTurn | null): LiveTurn | null {
  if (live === null || thread === null) return live;
  const stored = thread.messages.find((m) => m.id === live.tutorMessageId);
  if (stored === undefined) return live;
  if (stored.status !== 'streaming') return null;
  if (live.fromStart === true) return live;
  // The stored text may also be a little ahead: main saves what it has not sent yet (one 33 ms batch at most).
  const sameText = live.text.startsWith(stored.text) || stored.text.startsWith(live.text);
  return sameText && live.tools.length >= stored.tools.length ? live : null;
}

/** Whether a notice of `messageId` may start a live answer: the stored thread has nothing of it yet (else this window joined late). */
export function startsLive(thread: SessionThread | undefined, messageId: string): boolean {
  const stored = thread?.messages.find((m) => m.id === messageId);
  return stored === undefined || (stored.text === '' && stored.tools.length === 0);
}

/**
 * The answer of the session still coming: the live one, or a stored answer whose status is still streaming (a window that joined it
 * late); null when none comes. What 중지, esc and 답 중지 stop.
 */
export function comingAnswer(thread: SessionThread | null, stored: LiveTurn | null): string | null {
  const live = liveOver(thread, stored);
  if (live !== null) return live.tutorMessageId;
  return thread?.messages.find((m) => m.role === 'tutor' && m.status === 'streaming')?.id ?? null;
}

/** sessions:get as a query: the one read of a session that every reader of it shares. */
const threadQuery = (conversationId: string | null) => ({
  queryKey: keys.sessionThread(conversationId ?? ''),
  queryFn: () => unwrap(api().sessions.get({ conversationId: conversationId! })),
});

/**
 * The answer still coming in this session of the tab around the component: the session as read (the same shared query as the
 * conversation's, so it is read once) and its live answer. It keeps the session read even while the tutor is not on screen, so the
 * answer's end is seen there too (답 중지 is the palette's whatever the panel shows).
 */
export function useAnswerComing(conversationId: string | null): string | null {
  const stored = useTutorTab((s) => s.live);
  const read = useQuery({ ...threadQuery(conversationId), enabled: conversationId !== null });
  return conversationId === null ? null : comingAnswer(read.data ?? null, stored);
}

/** The same, outside a component: the answer still coming in the session the tab of `scope` shows. */
export function answerComingIn(scope: ReaderScope): string | null {
  const { conversationId, live } = scope.tutor.getState();
  if (conversationId === null) return null;
  return comingAnswer(queryClient.getQueryData<SessionThread>(keys.sessionThread(conversationId)) ?? null, live);
}

/** An answer of the thread is coming and the window has no live one over it: it joined that answer late. */
const joinedLate = (thread: SessionThread | undefined, live: LiveTurn | null): boolean =>
  thread !== undefined && liveOver(thread, live) === null && thread.messages.some((m) => m.role === 'tutor' && m.status === 'streaming');

/**
 * The tab's session as stored (sessions:get, `['sessions', 'get', id]`) and its answer still coming as the window hears it. The
 * stored thread is read again when an answer ends and when main says a session changed (data/queries.ts); while an answer this window
 * joined late is coming, every 2 s. A session that is gone (deleted, its item in the trash) leaves the tab on a new empty session. A read
 * that failed otherwise, with nothing read before it, is `failed`; `retry` reads it again.
 */
export function useSessionThread(conversationId: string | null): { thread: SessionThread | null; live: LiveTurn | null; failed: boolean; retry(): void } {
  const stored = useTutorTab((s) => s.live);
  const setLive = useTutorTab((s) => s.setLive);
  const setConversation = useTutorTab((s) => s.setConversation);
  const read = useQuery({
    ...threadQuery(conversationId),
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
  const { refetch } = read;
  const retry = useCallback(() => void refetch(), [refetch]);
  return { thread, live, failed: conversationId !== null && read.isError && !gone && read.data === undefined, retry };
}
