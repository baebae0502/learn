import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import type { LibraryItem, OrganizeTag } from '@learn/domain';
import { ApiError, api, unwrap } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { runPicked } from '../commands/registry';
import { useItems } from '../data/queries';
import { useScopeView } from '../library/useScopeView';
import type { TagsSelector } from '../organize/viewSettings';
import { useOrganize } from '../organize/useOrganize';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { MENU_SEPARATOR, MenuIconButton, type MenuEntry } from '../ui/MenuButton';
import { SearchField } from '../ui/SearchField';
import { tagActions } from './actions';
import { ChipGroup } from './ChipGroup';
import { TagChip } from './TagChip';
import { cloudChips, viewCounts } from './tagCloud';
import { useTagEdit } from './tagEdit';
import { useTagsSelector } from './useTagsSelector';

const NO_ITEMS: readonly LibraryItem[] = [];
const NO_TAGS: readonly OrganizeTag[] = [];
const NO_COUNTS: ReadonlyMap<string, number> = new Map();

export type SelectorMenuId = 'view' | 'all' | 'name' | 'count' | 'clear';

/**
 * The "…" menu (design-spec 7.3, spec 4.3): 표시 — 현재 보기의 태그만 / 모든 태그, 정렬 — 이름순 / 많이 쓴 순, and, only while
 * a filter is set, 태그 선택 해제 after a separator. Also drawn by the state board.
 */
export function selectorMenu(selector: TagsSelector, filterCount: number): readonly MenuEntry<SelectorMenuId>[] {
  const id = (name: SelectorMenuId) => `tag-menu-${name}`;
  return [
    {
      header: t.organize.tags.show,
      items: [
        { id: 'view', label: t.organize.tags.showView, checked: selector.show === 'view', testId: id('view') },
        { id: 'all', label: t.organize.tags.showAll, checked: selector.show === 'all', testId: id('all') },
      ],
    },
    MENU_SEPARATOR,
    {
      header: t.organize.tags.sort,
      items: [
        { id: 'name', label: t.organize.tags.sortName, checked: selector.sort === 'name', testId: id('name') },
        { id: 'count', label: t.organize.tags.sortCount, checked: selector.sort === 'count', testId: id('count') },
      ],
    },
    ...(filterCount > 0 ? [MENU_SEPARATOR, { id: 'clear' as const, label: t.organize.tags.clearFilter, testId: id('clear') }] : []),
  ];
}

/** The selector's one Tab stop (the chip its roving tabindex points at): where the focus goes when a button that was beside it is gone. */
export function focusTagStop(): void {
  document.querySelector<HTMLElement>('[data-testid="tag-selector"] [data-chip-id][tabindex="0"]')?.focus();
}

/**
 * The tag selector at the sidebar's foot (spec 4.3; mockup .tag-selector): the head with its "…" menu, the chips, the "태그 필터"
 * field. Drawn only while there are tags (the library view's `sidebarFoot`). A chip toggles the filter — the items must have
 * every chosen tag — ↩ renames it in place, the menu key or a right click opens its native menu.
 */
export function TagSelector() {
  const { model } = useOrganize();
  const list = useItems().data ?? NO_ITEMS;
  const { scoped } = useScopeView(list);
  const filter = useLibrary((s) => s.tagFilter);
  const toggleTag = useLibrary((s) => s.toggleTagFilter);
  const { selector, update, ready } = useTagsSelector();
  const { env, run } = useCommands();
  const envRef = useRef(env);
  envRef.current = env;
  const editingId = useTagEdit((s) => s.editingId);
  const restoreTo = useTagEdit((s) => s.restoreTo);
  const [query, setQuery] = useState('');

  const counts = useMemo(
    () => (model ? viewCounts(model.tags, (id) => model.tagItems(id), new Set(scoped.map((i) => i.id))) : NO_COUNTS),
    [model, scoped],
  );
  const chips = useMemo(() => cloudChips({ tags: model?.tags ?? NO_TAGS, counts, filter, selector, query }), [model, counts, filter, selector, query]);

  // A chip being renamed whose tag is gone (deleted from elsewhere): its edit ends.
  useEffect(() => {
    if (editingId !== null && model && !model.tags.some((x) => x.id === editingId)) useTagEdit.getState().end(false);
  }, [editingId, model]);
  // After a name field closes the focus goes back to the chip (or to what had it), unless a click elsewhere already put it somewhere.
  useEffect(() => {
    if (!restoreTo) return;
    const chip = restoreTo.tagId === null ? null : document.querySelector<HTMLElement>(`[data-chip-id="${CSS.escape(restoreTo.tagId)}"]`);
    (chip ?? (restoreTo.opener instanceof HTMLElement ? restoreTo.opener : null))?.focus();
    useTagEdit.getState().clearRestore();
  }, [restoreTo]);

  const openMenu = useCallback(async (tagId: string, at: { x: number; y: number }) => {
    try {
      const picked = await unwrap(api().ui.showContextMenu({ kind: 'tag', tagIds: [tagId], ...at }));
      if (picked) runPicked(picked, envRef.current, { tagIds: [tagId] });
    } catch (e) {
      console.warn(`[tags] the tag menu failed: ${e instanceof ApiError ? e.code : 'INTERNAL'}`); // the code only: no names in a log
    }
  }, []);

  if (!ready || !model || model.tags.length === 0) return null;
  const typed = query.trim() !== '';
  return (
    <div className="tag-selector" role="group" aria-labelledby="tag-selector-head" data-testid="tag-selector">
      <div className="head">
        <span id="tag-selector-head">{t.organize.tags.heading}</span>
        <span className="spacer" />
        <MenuIconButton
          label={t.organize.tags.moreLabel}
          icon={Ellipsis}
          testId="tag-selector-more"
          items={selectorMenu(selector, filter.size)}
          onAction={(id) => {
            if (id === 'clear') run('tags.clearFilter');
            else update(id === 'view' || id === 'all' ? { show: id } : { sort: id });
          }}
        />
      </div>
      <ChipGroup label={t.organize.tags.listLabel} className="tag-cloud" testId="tag-cloud">
        {chips.map(({ tag, on, dim }) => (
          <TagChip
            key={tag.id}
            tag={tag}
            role="filter"
            on={on}
            dim={dim}
            editing={editingId === tag.id}
            onToggle={() => toggleTag(tag.id)}
            onRename={() => tagActions.startRename(tag.id)}
            onMenu={(at) => void openMenu(tag.id, at)}
          />
        ))}
        {chips.length === 0 && (
          <span className="tag-none" data-testid="tag-none">
            {typed ? t.organize.tags.noMatch : t.organize.tags.noneInView}
          </span>
        )}
      </ChipGroup>
      <SearchField
        aria-label={t.organize.tags.filterLabel}
        placeholder={t.organize.tags.filterPlaceholder}
        size="small"
        value={query}
        onChange={setQuery}
        onClear={() => setQuery('')}
        testId="tag-filter-field"
        className="tag-field"
      />
    </div>
  );
}
