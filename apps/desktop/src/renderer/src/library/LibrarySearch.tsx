import { ariaKeyShortcuts, commandById, commandLabel, type LibraryItem } from '@learn/domain';
import { useItems } from '../data/queries';
import { focusPaneNamed } from '../shell/panes';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { SearchField } from '../ui/SearchField';
import { currentPlatform } from '../ui/platform';
import { focusFirstRow } from './tableDom';
import { useSearch } from './useSearch';

const NO_ITEMS: readonly LibraryItem[] = [];
/** The field's input while it is mounted (one toolbar per window): ⌘F reaches it from the registry. */
const field: { current: HTMLInputElement | null } = { current: null };

/** ⌘F (`library.find`): the quick search field takes the focus with its text selected (spec 4.1). */
export function focusQuickSearch(): void {
  field.current?.focus();
  field.current?.select();
}

/**
 * The toolbar's quick search (spec 4.1, design-spec 2.4): 240 wide after 가져오기, bound to the session's query.
 * esc empties it (RAC), and on an empty field hands the focus to the table, as F6 would land there; ↓ goes to the first
 * result. Named after its command, with ⌘F as its shortcut.
 */
export function LibrarySearch() {
  const query = useLibrary((s) => s.query);
  const setQuery = useLibrary((s) => s.setQuery);
  const found = useSearch(useItems().data ?? NO_ITEMS);
  const find = commandById('library.find');
  const platform = currentPlatform();
  return (
    <>
      <SearchField
        aria-label={commandLabel(find, platform)}
        aria-keyshortcuts={ariaKeyShortcuts(find.accelerator!, platform)}
        placeholder={t.library.searchPlaceholder}
        value={query}
        onChange={setQuery}
        inputRef={field}
        className="library-search"
        testId="search-field"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query === '') focusPaneNamed('content');
          else if (e.key === 'ArrowDown') {
            e.preventDefault(); // not the caret's end
            focusFirstRow();
          }
        }}
      />
      <span role="status" className="visually-hidden" data-testid="search-status">
        {found !== null && found.ids.size > 0 ? t.library.searchStatus(found.ids.size) : ''}
      </span>
    </>
  );
}
