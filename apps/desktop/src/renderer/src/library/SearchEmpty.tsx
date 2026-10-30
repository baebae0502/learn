import { SearchX } from 'lucide-react';
import { commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { PaneEmpty } from '../ui/PaneEmpty';
import { focusQuickSearch } from './LibrarySearch';

/**
 * Nothing matches the query (spec 3.3, 7.1), in the table body's place. It says where the search looked: the view's name
 * outside 내 라이브러리 (`view`, null in it), and how many tags narrowed the result. Two actions: empty the query, and —
 * outside 내 라이브러리 — search the whole library with the same query (the registry's library.findEverywhere).
 */
export function SearchEmpty({ query, view, tagCount }: { query: string; view: string | null; tagCount: number }) {
  const setQuery = useLibrary((s) => s.setQuery);
  const { run, isEnabled } = useCommands();
  const everywhere = commandById('library.findEverywhere');
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
      {t.library.searchEmptyBody(view, tagCount)}
    </PaneEmpty>
  );
}
