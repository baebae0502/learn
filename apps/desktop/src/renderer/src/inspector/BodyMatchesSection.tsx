import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListBox, ListBoxItem } from 'react-aria-components';
import type { BodyTextState, LibraryItem } from '@learn/domain';
import { ApiError } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { bodyPagesOptions, useBodyTarget } from '../library/useBodySearch';
import { t } from '../strings';
import { Spinner } from '../ui/Spinner';
import { matchesView, snippetParts } from './bodyText';
import { Section } from './Section';
import { useShownAfter } from './useShownAfter';

/** A load shorter than this shows nothing (design-spec 6). */
const LOADING_DELAY_MS = 300;

/**
 * 본문 일치 (spec 5.8): in the library's panel for one PDF while the quick search looks in 정보와 본문 with a body word — the
 * pages whose text has every word, each with its snippet, opening the reader there. While the body is not read (or cannot be),
 * the state line in their place, unless the original is missing (nothing will read it); an index cut at a limit says so under its
 * rows; a whole index with no match has no section (matchesView).
 */
export function BodyMatchesSection({ item, text }: { item: LibraryItem; text: BodyTextState | null }) {
  // The query typed now, as the table's body answer has it: the list empties and fills with the table's body rows.
  const { target, settled } = useBodyTarget();
  const on = target !== '' && item.type === 'pdf';
  const read = on && text?.state === 'done';
  const pages = useQuery(bodyPagesOptions(item.id, target, settled, read));
  const loading = useShownAfter(read && pages.isPending, LOADING_DELAY_MS);
  // A failed search:pages shows nothing, on purpose: the table's failed body answer claims nothing about the body either.
  useEffect(() => {
    if (pages.isError) console.warn(`[inspector] body pages failed: ${pages.error instanceof ApiError ? pages.error.code : 'INTERNAL'}`);
  }, [pages.isError, pages.error]);
  if (!on || text === null) return null;
  const found = pages.data;
  if (text.state === 'done' && found === undefined) {
    return loading ? (
      <Section id="matches" title={t.inspector.sections.matches} testId="matches-section">
        <div className="loading" role="status" data-testid="matches-loading">
          <Spinner />
          {t.inspector.matches.searching}
        </div>
      </Section>
    ) : null;
  }
  const view = matchesView(text, item.availability === 'missing', found?.total ?? 0);
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
            {t.inspector.matches.count(shown.total)}
          </span>
        )
      }
    >
      {shown && <MatchList itemId={item.id} query={target} pages={shown.pages} />}
      {shown && shown.total > shown.pages.length && (
        <div className="match-more num" data-testid="matches-more">
          {t.inspector.matches.more(shown.total - shown.pages.length)}
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

/** The pages as one list (one Tab stop, the arrows within it); ↩ or a click opens the reader at the row's page with this query. */
function MatchList({ itemId, query, pages }: { itemId: string; query: string; pages: ReadonlyArray<{ pageIndex: number; snippet: string }> }) {
  const { env } = useCommands();
  const rows = useMemo(
    () =>
      pages.map((p) => {
        const parts = snippetParts(p.snippet);
        return { pageIndex: p.pageIndex, parts, name: t.inspector.matches.rowName(p.pageIndex + 1, parts.map((part) => part.text).join('')) };
      }),
    [pages],
  );
  return (
    <ListBox aria-label={t.inspector.sections.matches} className="match-list" data-testid="match-list" onAction={(key) => env.openAtPage(itemId, { pageIndex: Number(key), query })}>
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
