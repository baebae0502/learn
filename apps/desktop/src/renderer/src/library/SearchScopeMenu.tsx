import { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Button as AriaButton, MenuTrigger, Popover } from 'react-aria-components';
import type { SearchScope } from '@learn/domain';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { MENU_SEPARATOR, MenuList, type MenuEntry } from '../ui/MenuButton';
import { Tooltip } from '../ui/Tooltip';
import { indexing } from './bodySearch';
import { useBodyProgress, useSearchScope } from './useBodySearch';

type ScopeKey = SearchScope | 'progress';

/**
 * 검색 범위 ▾ (spec 5.8): the quick search field's first element, in the magnifier's place. A web pop-up menu of the
 * field's own, as the tag selector's "…" (design-spec 7.3) — no registry command, no menu bar entry, no shortcut. Two
 * rows, each saying what it searches; while PDFs are still being indexed a line under them counts them. The choice is
 * the library's (library.searchScope). `isDisabled`: the field is held (the list loads, a sheet or an import holds the
 * window); the button keeps its focus and never opens.
 */
export function SearchScopeButton({ isDisabled = false }: { isDisabled?: boolean }) {
  const [scope, setScope] = useSearchScope();
  const progress = useBodyProgress();
  // Controlled, so a held button can never open the menu.
  const [isOpen, setOpen] = useState(false);
  const entries: MenuEntry<ScopeKey>[] = [
    { id: 'metadata', label: t.library.scope.metadata, description: t.library.scope.metadataDescription, checked: scope === 'metadata', testId: 'search-scope-metadata' },
    { id: 'fulltext', label: t.library.scope.fulltext, description: t.library.scope.fulltextDescription, checked: scope === 'fulltext', testId: 'search-scope-fulltext' },
  ];
  // Its own group: a line that tells is not one of the choices.
  if (indexing(progress)) entries.push(MENU_SEPARATOR, { items: [{ id: 'progress', label: t.library.scope.progress(progress.done, progress.total), info: true, testId: 'search-scope-progress' }] });
  return (
    <MenuTrigger isOpen={isOpen && !isDisabled} onOpenChange={(open) => setOpen(open && !isDisabled)}>
      <Tooltip label={t.library.scope.label}>
        {/* slot={null}: inside the search field a button is otherwise its clear button (RAC's ButtonContext). */}
        <AriaButton slot={null} className="scope-btn" aria-label={t.library.scope.label} aria-disabled={isDisabled || undefined} data-testid="search-scope">
          <Icon icon={Search} size="sm" />
          <Icon icon={ChevronDown} size="xs" />
        </AriaButton>
      </Tooltip>
      <Popover className="menu-popover scope-popover" placement="bottom start" offset={4}>
        <MenuList
          entries={entries}
          onAction={(id) => {
            if (id !== 'progress') setScope(id);
          }}
          aria-label={t.library.scope.label}
          testId="search-scope-menu"
        />
      </Popover>
    </MenuTrigger>
  );
}
