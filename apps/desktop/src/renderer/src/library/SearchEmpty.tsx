import { Fragment } from 'react';
import { SearchX } from 'lucide-react';
import { commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { useInTrash } from '../trash/useTrashSource';
import { Button } from '../ui/Button';
import { PaneEmpty } from '../ui/PaneEmpty';
import { Spinner } from '../ui/Spinner';
import { emptyNote } from './bodySearch';
import { focusQuickSearch } from './LibrarySearch';
import { useBodyProgress, useSearchScope } from './useBodySearch';

/**
 * Nothing matches the query (spec 3.3, 7.1), in the table body's place. It says where the search looked: the view's name
 * outside 내 라이브러리 (`view`, null in it), the PDFs' body when it was searched (`bodySearched`, search:body's answer),
 * and how many tags narrowed the result. In 정보와 본문 a line under it says what the body search could not cover yet
 * (one-letter words, PDFs still being indexed). Two actions: empty the query, and — outside 내 라이브러리 — search the
 * whole library with the same query (the registry's library.findEverywhere).
 */
export function SearchEmpty({ query, view, tagCount, bodySearched }: { query: string; view: string | null; tagCount: number; bodySearched: boolean }) {
  const setQuery = useLibrary((s) => s.setQuery);
  const { run, isEnabled } = useCommands();
  const everywhere = commandById('library.findEverywhere');
  const [scope] = useSearchScope();
  const inTrash = useInTrash();
  const progress = useBodyProgress();
  const notes = emptyNote({ scope: inTrash ? 'metadata' : scope, query, searched: bodySearched, progress });
  return (
    <PaneEmpty
      icon={SearchX}
      title={t.library.searchEmptyTitle(query)}
      top
      testId="search-empty"
      action={
        <div className="pe-actions">
          <Button
            testId="search-empty-clear"
            onPress={() => {
              setQuery('');
              focusQuickSearch(); // the button goes with the state; typing goes on in the field
            }}
          >
            {t.library.searchClear}
          </Button>
          {view !== null && (
            <Button
              testId="search-empty-everywhere"
              isDisabled={!isEnabled(everywhere.id)}
              disabledReason={t.common.busy}
              onPress={() => {
                // The view changes and the query stays; the button may go with the empty state, so the field takes the focus.
                if (run(everywhere.id)) focusQuickSearch({ select: false });
              }}
            >
              {everywhere.label}
            </Button>
          )}
        </div>
      }
    >
      {t.library.searchEmptyBody(view, tagCount, bodySearched)}
      {notes.map((note) => (
        <Fragment key={note}>
          <br />
          {note}
        </Fragment>
      ))}
    </PaneEmpty>
  );
}

/**
 * The body answer is still on its way, nothing else is in the table, and it has taken 300 ms (design-spec 6): the
 * loading line in the body's place, as the list's own (LibraryLoading), until the rows or the no-results state come.
 */
export function SearchPending() {
  return (
    <div className="pane-empty top" data-testid="search-pending">
      <div className="loading" role="status">
        <Spinner />
        {t.library.searching}
      </div>
    </div>
  );
}
