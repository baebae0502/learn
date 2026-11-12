import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { MessageView } from '@learn/domain';
import { useItem } from '../data/queries';
import { useLearnEvent } from '../events';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { useReader } from '../viewers/pdf/readerStore';
import { useReaderScope } from '../viewers/readerScope';
import { TutorBubble, UserBubble, type CiteTarget } from './Bubble';
import { nearBottom, nextFollow } from './follow';
import { SessionHead, StickyName } from './SessionHead';
import { useTutorTab } from './tutorStore';
import { useSessionThread } from './useSessionThread';

const { conversation: words } = t.tutor;

/** The answer to the question at `k`: the message after it, when it is the tutor's. */
const answerTo = (messages: readonly MessageView[], k: number): MessageView | null => (messages[k + 1]?.role === 'tutor' ? messages[k + 1]! : null);

/**
 * The conversation column (spec 8.2, 8.3): the session's head line, then the turns, in a log that is not a live region — it is
 * one Tab stop and scrolls with the arrows and PageUp/PageDown. While an answer comes the column keeps to its bottom, unless the user
 * scrolled up: then 최신으로 waits above the composer, and stays after the answer ended while there is unread text below. Scrolled
 * past the head line, the session's name is a row under the panel head, above the log. A hidden status says once that the answer came
 * or was stopped. A pressed chip is the current one while the reader shows its page. `visible`: the panel can be seen — a folded one
 * does not follow sizes.
 */
export function Conversation({ conversationId, visible }: { conversationId: string; visible: boolean }) {
  const { thread, live } = useSessionThread(conversationId);
  const scope = useReaderScope();
  const revisionId = useItem(scope.id).data?.revisionId ?? null;
  const pageCount = useReader((s) => s.pdf?.pagesCount ?? 0);
  const page = useReader((s) => s.pdf?.pageNumber ?? null);
  const currentCite = useTutorTab((s) => s.currentCite);
  const setCurrentCite = useTutorTab((s) => s.setCurrentCite);
  const target = useMemo<CiteTarget>(
    () => ({
      revisionId,
      pageCount,
      go: (pageIndex, key) => {
        setCurrentCite({ key, pageIndex, shown: false });
        const handle = scope.reader.getState().handle;
        handle?.jumpToPage(pageIndex + 1);
        handle?.flashPage(pageIndex);
      },
      current: currentCite?.key ?? null,
    }),
    [revisionId, pageCount, scope, setCurrentCite, currentCite?.key],
  );
  // The pressed chip keeps its ring while the reader shows its page: once the reader is there, leaving the page (a scroll, another
  // jump, back or forward) ends it.
  useEffect(() => {
    if (currentCite === null || page === null) return;
    if (page - 1 === currentCite.pageIndex) {
      if (!currentCite.shown) setCurrentCite({ ...currentCite, shown: true });
    } else if (currentCite.shown) setCurrentCite(null);
  }, [page, currentCite, setCurrentCite]);
  const streaming = live !== null || (thread?.messages.some((m) => m.role === 'tutor' && m.status === 'streaming') ?? false);

  const logRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const unread = useRef(false);
  const lastTop = useRef(0);
  const lastHeight = useRef(0);
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [latest, setLatest] = useState(false);
  const [stuck, setStuck] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);
  const stickyHeight = useRef(0);

  /** 최신으로 shows while the user is away from the bottom and an answer comes, or text came below that they have not seen. */
  const settle = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const head = headRef.current;
    setStuck(head !== null && el.scrollTop > head.offsetTop + head.offsetHeight);
    setLatest(!following.current && !nearBottom(el) && (streamingRef.current || unread.current));
  }, []);
  const toBottom = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, []);
  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    if (nearBottom(el)) {
      following.current = nextFollow(following.current, 'reached-bottom');
      unread.current = false;
    } else if (el.scrollTop < lastTop.current) following.current = nextFollow(following.current, 'scrolled-up');
    lastTop.current = el.scrollTop;
    settle();
  };

  // The column's content or its own height changed: keep to the bottom while following, else count what came below as unread.
  const loaded = thread !== null;
  useLayoutEffect(() => {
    const el = logRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const watch = new ResizeObserver(() => {
      if (!visibleRef.current) return;
      const grew = el.scrollHeight > lastHeight.current;
      lastHeight.current = el.scrollHeight;
      following.current = nextFollow(following.current, 'append');
      if (following.current) toBottom();
      // What the answer wrote below, not a list opened above, is unread.
      else if (grew && streamingRef.current) unread.current = true;
      settle();
    });
    watch.observe(el);
    watch.observe(content);
    return () => watch.disconnect();
  }, [loaded, toBottom, settle]);

  // Another session, or a new question asked: the column starts at its bottom, following.
  const questions = thread?.messages.filter((m) => m.role === 'user').length ?? 0;
  useLayoutEffect(() => {
    following.current = true;
    unread.current = false;
    if (visibleRef.current) toBottom();
    settle();
  }, [conversationId, questions, loaded, toBottom, settle]);
  // Shown again after the panel was folded: back to the bottom if it was following (sizes were not followed meanwhile).
  useLayoutEffect(() => {
    if (!visible) return;
    if (following.current) toBottom();
    settle();
  }, [visible, toBottom, settle]);
  useEffect(settle, [streaming, settle]);
  // The name's row takes its height from the top of the log: the log scrolls by that much too, so the text in view stays where it was.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (stuck) {
      stickyHeight.current = stickyRef.current?.offsetHeight ?? 0;
      el.scrollTop += stickyHeight.current;
    } else if (stickyHeight.current > 0) {
      el.scrollTop -= stickyHeight.current;
      stickyHeight.current = 0;
    }
    lastTop.current = el.scrollTop;
  }, [stuck]);

  const toLatest = () => {
    const hadFocus = document.activeElement instanceof HTMLElement && document.activeElement.closest('.tutor-latest-row') !== null;
    following.current = nextFollow(following.current, 'pressed-latest');
    unread.current = false;
    toBottom();
    settle();
    // The button goes with the press: the focus stays in the column it brought down.
    if (hadFocus) logRef.current?.focus();
  };

  const [said, setSaid] = useState('');
  useLearnEvent('tutor:turn', (e) => {
    if (e.conversationId !== conversationId) return;
    if (e.kind === 'done') setSaid(e.status === 'stopped' ? words.stopped : words.received);
    else if (e.kind === 'text' || e.kind === 'tool') setSaid((s) => (s === '' ? s : ''));
  });

  if (thread === null) return <div className="tutor-convo" data-testid="tutor-conversation" />;
  const { messages, session, item } = thread;
  return (
    <div className="tutor-convo" data-testid="tutor-conversation" data-streaming={streaming ? '' : undefined}>
      <StickyName title={session.title} shown={stuck} ref={stickyRef} />
      <div ref={logRef} className="tutor-log" role="log" aria-label={words.label} aria-live="off" tabIndex={0} onScroll={onScroll} data-testid="tutor-log">
        <div ref={contentRef} className="tutor-log-content">
          <SessionHead ref={headRef} session={session} />
          {messages.map((m, k) =>
            m.role === 'user' ? (
              <UserBubble key={m.id} message={m} answer={answerTo(messages, k)} itemTitle={item.title} agent={session.agent} target={target} />
            ) : (
              <TutorBubble key={m.id} message={m} live={live?.tutorMessageId === m.id ? live : null} mixed={session.mixedAgents} target={target} />
            ),
          )}
        </div>
      </div>
      {latest && (
        <div className="tutor-latest-row">
          <Button size="small" icon={ArrowDown} onPress={toLatest} testId="tutor-latest">
            {words.latest}
          </Button>
        </div>
      )}
      <span className="visually-hidden" role="status" data-testid="tutor-said">
        {said}
      </span>
    </div>
  );
}
