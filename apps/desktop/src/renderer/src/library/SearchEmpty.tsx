import { SearchX } from 'lucide-react';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { PaneEmpty } from '../ui/PaneEmpty';
import { focusQuickSearch } from './LibrarySearch';

/** Nothing matches the query (spec 4.3), in the table body's place; its one action empties the query (M5 adds a second). */
export function SearchEmpty({ query }: { query: string }) {
  const setQuery = useLibrary((s) => s.setQuery);
  return (
    <PaneEmpty
      icon={SearchX}
      title={t.library.searchEmptyTitle(query)}
      top
      testId="search-empty"
      action={
        <Button
          testId="search-empty-clear"
          onPress={() => {
            setQuery('');
            focusQuickSearch(); // the button goes with the state; typing goes on in the field
          }}
        >
          {t.library.searchClear}
        </Button>
      }
    >
      {t.library.searchEmptyBody}
    </PaneEmpty>
  );
}
