import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, CircleAlert } from 'lucide-react';
import type { MessageView } from '@learn/domain';
import { useItem, useItemDetail } from '../data/queries';
import { useLearnEvent } from '../events';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { useReader } from '../viewers/pdf/readerStore';
import { useReaderScope } from '../viewers/readerScope';
import { TutorBubble, UserBubble, type CiteTarget } from './Bubble';
import { answerCheck, knownPageCount, regroundBubble } from './failureCopy';
import { nearBottom, nextFollow } from './follow';
import { createLogFocus } from './logFocus';
import { SessionHead, StickyName } from './SessionHead';
import { ringedChip, useTutorTab, type TurnNotice } from './tutorStore';
import { TurnFailure, TutorNotice } from './TurnFailure';
import { useSessionThread } from './useSessionThread';

const { conversation: words } = t.tutor;

/** The answer to the question at `k`: the message after it, when it is the tutor's. */
const answerTo = (messages: readonly MessageView[], k: number): MessageView | null => (messages[k + 1]?.role === 'tutor' ? messages[k + 1]! : null);

/**
 * What a 원문 근거 요청's bubble says: the pages the answer before it cited without reading them, inside the document; while the page
 * count is not known (no page can be told past the last one), and where no page can be named, what the request is.
 */
function regroundWords(before: MessageView | undefined, pageCount: number): string {
  const check = before?.role === 'tutor' ? answerCheck(before, pageCount) : null;
  return (check === null ? null : regroundBubble(check)) ?? t.tutor.scope.reground;
}

/** Where a failure before the answer stands: after the last message at or before its place (-1: before them all). */
const noticeIndex = (messages: readonly MessageView[], notice: TurnNotice): number => messages.reduce((at, m, k) => (m.seq <= notice.afterSeq ? k : at), -1);

/** A failure before the answer, where its turn would have been (spec 8.8): the question is back in the composer. */
export function BeforeNotice({ notice }: { notice: TurnNotice }) {
  return <TurnFailure code={notice.code} phase="before" agent={notice.agent} form={notice.reground === true ? 'noBody' : 'full'} />;
}

/** The session's thread could not be read (anything but its being gone): the notice in the column's place, and 다시 시도. */
function ThreadFailed({ retry }: { retry(): void }) {
  return (
    <div className="tutor-convo-failed">
      <TutorNotice icon={CircleAlert} tone="danger" title={t.tutor.failure.thread} testId="tutor-thread-failed">
        <div className="nt-actions">
          <Button size="small" onPress={retry} testId="tutor-thread-retry">
            {t.common.retry}
          </Button>
        </div>
      </TutorNotice>
    </div>
  );
}

/**
 * The pressed chip keeps its ring while the reader shows its page: once the reader is there, leaving the page (a scroll, another jump,
 * back or forward) ends it. A component of its own, drawing nothing: a page turned in the reader draws this again, not the column.
 */
function CurrentCiteWatch() {
  const page = useReader((s) => s.pdf?.pageNumber ?? null);
  const currentCite = useTutorTab((s) => s.currentCite);
  const setCurrentCite = useTutorTab((s) => s.setCurrentCite);
  useEffect(() => {
    if (currentCite === null || page === null) return;
    if (page - 1 === currentCite.pageIndex) {
      if (!currentCite.shown) setCurrentCite({ ...currentCite, shown: true });
    } else if (currentCite.shown) setCurrentCite(null);
  }, [page, currentCite, setCurrentCite]);
  return null;
}

/**
 * The conversation column (spec 8.2, 8.3): the session's head line, then the turns, in a log that is not a live region — it is
 * one Tab stop and scrolls with the arrows and PageUp/PageDown. While an answer comes the column keeps to its bottom, unless the user
 * scrolled up: then 최신으로 waits above the composer, and stays after the answer ended while there is unread text below. Scrolled
 * past the head line, the session's name is a row under the panel head, above the log. A hidden status says once that the answer came
 * or was stopped. A pressed chip is the current one while the reader shows its page. `visible`: the panel can be seen — a folded one
 * does not follow sizes.
 */
export function Conversation({ conversationId, visible }: { conversationId: string; visible: boolean }) {
  const { thread, live, failed, retry } = useSessionThread(conversationId);
  const notice = useTutorTab((s) => s.notice);
  const refused = useTutorTab((s) => s.retryRefused);
  const scope = useReaderScope();
  const revisionId = useItem(scope.id).data?.revisionId ?? null;
  // Until pdf.js has the document, the body index's page count (a whole index read every page); 0 while neither is known.
  const pageCount = knownPageCount(useReader((s) => s.pdf?.pagesCount ?? 0), useItemDetail(scope.id).data?.text);
  // The ringed chip's key alone: the chip's other changes (its page shown) and the reader's page do not draw the column again.
  const ringed = useTutorTab((s) => ringedChip(s.currentCite, revisionId));
  const setCurrentCite = useTutorTab((s) => s.setCurrentCite);
  const target = useMemo<CiteTarget>(
    () => ({
      revisionId,
      pageCount,
      go: (pageIndex, key, revision) => {
        setCurrentCite({ key, pageIndex, revisionId: revision, shown: false });
        const handle = scope.reader.getState().handle;
        handle?.jumpToPage(pageIndex + 1);
        handle?.flashPage(pageIndex);
      },
      current: ringed,
    }),
    [revisionId, pageCount, scope, setCurrentCite, ringed],
  );
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
  const stuckRef = useRef(false);
  // Owed the focus (a session row's click opened the folded panel and folded its sidebar): taken once the column is drawn and seen,
  // let go when the read fails or the panel is folded again first.
  const logFocus = useTutorTab((s) => s.logFocus);
  const setLogFocus = useTutorTab((s) => s.setLogFocus);
  const owedFocus = useRef(createLogFocus());
  const drawn = thread !== null;
  useEffect(() => {
    const step = owedFocus.current.step({ owed: logFocus, drawn, visible, failed });
    if (step === 'take') logRef.current?.focus({ preventScroll: true });
    if (step === 'take' || step === 'drop') setLogFocus(false);
  }, [logFocus, drawn, visible, failed, setLogFocus]);
  const stickyRef = useRef<HTMLDivElement>(null);
  const stickyHeight = useRef(0);

  /**
   * 최신으로 shows while the user is away from the bottom and an answer comes, or text came below that they have not seen. The name row
   * shows once the column is scrolled past its head line. `scrolled`: called from a scroll, which the frame being drawn already holds —
   * a row that comes or goes is drawn in that frame too, with its scroll make-up, or the text would jump by the row's height a frame
   * later (at the top the log cannot scroll to make up for it).
   */
  const settle = useCallback((scrolled = false) => {
    const el = logRef.current;
    if (!el) return;
    const head = headRef.current;
    const next = head !== null && el.scrollTop > head.offsetTop + head.offsetHeight;
    if (scrolled && next !== stuckRef.current) flushSync(() => setStuck(next));
    else setStuck(next);
    stuckRef.current = next;
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
    settle(true);
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
      // Not flushed: the observer runs after layout and before paint, and a commit forced inside it resizes what it watches (the
      // "ResizeObserver loop" error). The row's make-up comes in the commit that adds it; a scroll that crosses the head line is the
      // scroll handler's, which flushes.
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
  // A failure before its answer, standing in that turn's place: no question row is written, so nothing else brings it into view from a
  // column scrolled up. It is new content at the end, as a question is; a notice that goes away is none.
  useLayoutEffect(() => {
    if (notice === null) return;
    following.current = true;
    unread.current = false;
    if (visibleRef.current) toBottom();
    settle();
  }, [notice, toBottom, settle]);
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

  if (thread === null) {
    return (
      <div className="tutor-convo" data-testid="tutor-conversation" data-conversation-id={conversationId}>
        <CurrentCiteWatch />
        {failed && <ThreadFailed retry={retry} />}
      </div>
    );
  }
  const { messages, session, item } = thread;
  const at = notice === null ? null : noticeIndex(messages, notice);
  const before = notice === null ? null : <BeforeNotice notice={notice} />;
  return (
    <div className="tutor-convo" data-testid="tutor-conversation" data-conversation-id={conversationId} data-drawn="" data-streaming={streaming ? '' : undefined}>
      <CurrentCiteWatch />
      <StickyName title={session.title} shown={stuck} ref={stickyRef} />
      <div ref={logRef} className="tutor-log" role="log" aria-label={words.label} aria-live="off" tabIndex={0} onScroll={onScroll} data-testid="tutor-log">
        <div ref={contentRef} className="tutor-log-content">
          <SessionHead ref={headRef} session={session} />
          {at === -1 && before}
          {messages.map((m, k) => (
            <Fragment key={m.id}>
              {m.role === 'user' ? (
                <UserBubble
                  message={m}
                  answer={answerTo(messages, k)}
                  itemTitle={item.title}
                  agent={session.agent}
                  target={target}
                  shown={m.kind === 'reground' ? regroundWords(messages[k - 1], pageCount) : undefined}
                />
              ) : (
                <TutorBubble
                  message={m}
                  live={live?.tutorMessageId === m.id ? live : null}
                  mixed={session.mixedAgents}
                  target={target}
                  agent={session.agent}
                  last={k === messages.length - 1}
                  refused={refused?.messageId === m.id ? refused.code : null}
                />
              )}
              {k === at && before}
            </Fragment>
          ))}
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
