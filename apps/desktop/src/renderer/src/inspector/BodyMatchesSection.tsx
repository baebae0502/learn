import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListBox, ListBoxItem } from 'react-aria-components';
import type { BodyTextState, LibraryItem } from '@learn/domain';
import { ApiError, api, unwrap } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { keys } from '../data/queries';
import { useSearchScope, useSettledBodyQuery } from '../library/useBodySearch';
import { t } from '../strings';
import { Spinner } from '../ui/Spinner';
import { bodyStateLine, snippetParts } from './bodyText';
import { Section } from './Section';
import { useShownAfter } from './useShownAfter';

/** A load shorter than this shows nothing (design-spec 6). */
const LOADING_DELAY_MS = 300;

/**
 * 본문 일치 (spec 5.8): in the library's panel for one PDF while the quick search looks in 정보와 본문 with a body word — the
 * pages whose text has every word, each with its snippet, opening the reader there. While the body is not read (or cannot be),
 * the state line in their place; a read body with no match has no section.
 */
export function BodyMatchesSection({ item, text }: { item: LibraryItem; text: BodyTextState | null }) {
  const [scope] = useSearchScope();
  const query = useSettledBodyQuery();
  const on = scope === 'fulltext' && query !== '' && item.type === 'pdf';
  const read = on && text?.state === 'done';
  const pages = useQuery({
    queryKey: keys.bodyPages(item.id, query),
    queryFn: () => unwrap(api().search.pages({ itemId: item.id, query })),
    enabled: read,
  });
  const loading = useShownAfter(read && pages.isPending, LOADING_DELAY_MS);
  useEffect(() => {
    if (pages.isError) console.warn(`[inspector] body pages failed: ${pages.error instanceof ApiError ? pages.error.code : 'INTERNAL'}`);
  }, [pages.isError, pages.error]);
  if (!on || text === null) return null;
  if (text.state !== 'done') {
    return (
      <Section id="matches" title={t.inspector.sections.matches} testId="matches-section">
        <div className="match-status" data-testid="matches-status">
          {bodyStateLine(text)}
        </div>
      </Section>
    );
  }
  const found = pages.data;
  if (found === undefined) {
    return loading ? (
      <Section id="matches" title={t.inspector.sections.matches} testId="matches-section">
        <div className="loading" role="status" data-testid="matches-loading">
          <Spinner />
          {t.inspector.matches.searching}
        </div>
      </Section>
    ) : null;
  }
  if (found.total === 0) return null;
  return (
    <Section
      id="matches"
      title={t.inspector.sections.matches}
      testId="matches-section"
      extra={
        <span className="section-count num" data-testid="matches-count">
          {t.inspector.matches.count(found.total)}
        </span>
      }
    >
      <MatchList itemId={item.id} query={query} pages={found.pages} />
      {found.total > found.pages.length && (
        <div className="match-more num" data-testid="matches-more">
          {t.inspector.matches.more(found.total - found.pages.length)}
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
