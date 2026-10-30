import { commandById, commandLabel } from '@learn/domain';
import type { TagsSelector } from '../organize/viewSettings';
import { t } from '../strings';
import { MENU_SEPARATOR, type MenuEntry } from '../ui/MenuButton';
import { currentPlatform } from '../ui/platform';

export type SelectorMenuId = 'view' | 'all' | 'name' | 'count' | 'clear';

/**
 * The "…" menu (design-spec 7.3, spec 4.3): 표시 — 현재 보기의 태그만 / 모든 태그, 정렬 — 이름순 / 많이 쓴 순, and, only while
 * a filter is set, 태그 선택 해제 after a separator (the registry's label, as the palette and the empty state show it). Also drawn by the state board.
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
    ...(filterCount > 0 ? [MENU_SEPARATOR, { id: 'clear' as const, label: commandLabel(commandById('tags.clearFilter'), currentPlatform()), testId: id('clear') }] : []),
  ];
}
