import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListBox, ListBoxItem } from 'react-aria-components';
import { findWordOf, type BodyTextState, type LibraryItem } from '@learn/domain';
import { ApiError } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { bodyPagesOptions, useBodyTarget } from '../library/useBodySearch';
import { t } from '../strings';
import { Spinner } from '../ui/Spinner';
import { useTracks } from '../viewers/video/useSubtitles';
import { trackNames } from '../viewers/video/trackNames';
import { matchesView, snippetParts, timeRows, type SnippetPart, type TimeRowView } from './bodyText';
import { Section } from './Section';
import { useFileFacts } from './useFileFacts';
import { useShownAfter } from './useShownAfter';

/** A load shorter than this shows nothing (design-spec 6). */
const LOADING_DELAY_MS = 300;

/**
 * 본문 일치 (spec 5.8, M8a 8.2): in the library's panel for one PDF or video while the quick search looks in 정보와 본문 with a body
 * word — the pages (or a video's sentences, each at its start time) whose text has every word, each with its snippet, opening the
 * reader there. While the body is not read (or cannot be),
 * the state line in their place, unless the original is missing (nothing will read it); an index cut at a limit says so under its
 * rows; a whole index with no match has no section (matchesView).
 */
export function BodyMatchesSection({ item, text }: { item: LibraryItem; text: BodyTextState | null }) {
  // The query typed now, as the table's body answer has it: the list empties and fills with the table's body rows.
  const { target, settled } = useBodyTarget();
  // A video's sentences are indexed when its subtitles are attached: there is no state to wait for.
  const video = item.type === 'video';
  const on = target !== '' && (item.type === 'pdf' || video);
  const read = on && (video || text?.state === 'done');
  const pages = useQuery(bodyPagesOptions(item.id, target, settled, read));
  const loading = useShownAfter(read && pages.isPending, LOADING_DELAY_MS);
  // A failed search:matches shows nothing, on purpose: the table's failed body answer claims nothing about the body either.
  useEffect(() => {
    if (pages.isError) console.warn(`[inspector] body pages failed: ${pages.error instanceof ApiError ? pages.error.code : 'INTERNAL'}`);
  }, [pages.isError, pages.error]);
  if (!on || (!video && text === null)) return null;
  const found = pages.data;
  if (found === undefined && (video || text?.state === 'done')) {
    return loading ? (
      <Section id="matches" title={t.inspector.sections.matches} testId="matches-section">
        <div className="loading" role="status" data-testid="matches-loading">
          <Spinner />
          {t.inspector.matches.searching}
        </div>
      </Section>
    ) : null;
  }
  const view = video ? ((found?.total ?? 0) > 0 ? { rows: true, line: null } : null) : matchesView(text!, item.availability === 'missing', found?.total ?? 0);
  if (view === null) return null;
  const shown = view.rows ? found : undefined;
  return (
    <Section
      id="matches"
      title={t.inspector.sections.matches}
      testId="matches-section"
      extra={
        shown && (
          <span className="section-count num" data-testid="matches-count">
            {video ? t.inspector.matches.cueCount(shown.total) : t.inspector.matches.count(shown.total)}
          </span>
        )
      }
    >
      {shown && (video ? <TimeList item={item} query={target} times={shown.times} /> : <MatchList itemId={item.id} query={target} pages={shown.pages} />)}
      {shown && shown.total > shown.pages.length + shown.times.length && (
        <div className="match-more num" data-testid="matches-more">
          {video ? t.inspector.matches.moreCues(shown.total - shown.times.length) : t.inspector.matches.more(shown.total - shown.pages.length)}
        </div>
      )}
      {view.line !== null && (
        <div className="match-status" data-testid="matches-status">
          {view.line}
        </div>
      )}
    </Section>
  );
}

/**
 * The pages as one list (one Tab stop, the arrows within it); ↩ or a click opens the reader at the row's page, its find bar on
 * one word of this query: the page holds every word, not always side by side, and the find bar searches its text as one phrase.
 */
function MatchList({ itemId, query, pages }: { itemId: string; query: string; pages: ReadonlyArray<{ pageIndex: number; snippet: string }> }) {
  const { env } = useCommands();
  const findWord = findWordOf(query);
  const rows = useMemo(
    () =>
      pages.map((p) => {
        const parts = snippetParts(p.snippet);
        return { pageIndex: p.pageIndex, parts, name: t.inspector.matches.rowName(p.pageIndex + 1, parts.map((part) => part.text).join('')) };
      }),
    [pages],
  );
  return (
    <ListBox aria-label={t.inspector.sections.matches} className="match-list" data-testid="match-list" onAction={(key) => env.openAt(itemId, { kind: 'page', pageIndex: Number(key), query: findWord })}>
      {rows.map((row) => (
        // Named "12쪽, <snippet>". The space between the two columns is no box of the grid, but it keeps the shown words ("12쪽 <snippet>")
        // inside the name, as a label must (axe label-content-name-mismatch).
        <ListBoxItem key={row.pageIndex} id={row.pageIndex} textValue={row.name} aria-label={row.name} className="match-row" data-testid="match-row" data-page={row.pageIndex + 1}>
          <span className="pg num">{t.inspector.matches.page(row.pageIndex + 1)}</span>{' '}
          <span className="snip">{row.parts.map((part, i) => (part.mark ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}</span>
        </ListBoxItem>
      ))}
    </ListBox>
  );
}

const Snippet = ({ parts }: { parts: SnippetPart[] }) => (
  <span className="snip">{parts.map((part, i) => (part.mark ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}</span>
);

/**
 * A video's sentences as one list, as MatchList is for pages: ↩ or a click opens the video at the row's start with the transcript search on
 * the query (the reader narrows it to one word when that sentence does not hold it whole). With several tracks a row names its track,
 * and the label column takes the widest label. The clocks follow the video's length, as the player's do.
 */
function TimeList({ item, query, times }: { item: LibraryItem; query: string; times: ReadonlyArray<{ startMs: number; snippet: string; track: string | null }> }) {
  const itemId = item.id;
  const { env } = useCommands();
  const tracks = useTracks(itemId);
  const names = useMemo(() => trackNames(tracks ?? []), [tracks]);
  const facts = useFileFacts(item);
  const rows: TimeRowView[] = useMemo(() => timeRows(times, names, facts.durationMs), [times, names, facts.durationMs]);
  return (
    <ListBox
      aria-label={t.inspector.sections.matches}
      className={`match-list${rows.some((r) => r.track !== null) ? ' tracks' : ''}`}
      data-testid="match-list"
      onAction={(key) => {
        const row = rows.find((r) => r.key === key);
        if (row) env.openAt(itemId, { kind: 'time', startMs: row.startMs, query, track: row.track });
      }}
    >
      {rows.map((row) => (
        <ListBoxItem key={row.key} id={row.key} textValue={row.name} aria-label={row.name} className="match-row" data-testid="match-row" data-time={row.startMs}>
          <span className="pg num">
            <span className="clk">{row.clock}</span>
            {row.trackName !== null && (
              <>
                {'\u00a0·\u00a0'}
                <span className="trk" title={row.trackName}>{row.trackName}</span>
              </>
            )}
          </span>{' '}
          <Snippet parts={row.parts} />
        </ListBoxItem>
      ))}
    </ListBox>
  );
}
