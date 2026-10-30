import { useMemo } from 'react';
import { useItems, usePrefs } from '../data/queries';
import { useSidebarDnd, type FilesDropHandler } from '../dnd/treeDnd';
import { defaultDensity, density as ROW_HEIGHT } from '../design/tokens';
import { recentItems, resolveScope } from '../organize/scope';
import { useOrganize } from '../organize/useOrganize';
import { useLibrary } from '../state/library-store';
import { useShell } from '../state/shell-store';
import { useNow } from '../useNow';
import { SidebarTree } from './SidebarTree';
import { visibleSpecials } from './rows';
import { useExpanded } from './useExpanded';

const NO_ITEMS: readonly never[] = [];

/** The library's navigator in the sidebar (spec 3.2–3.4): the special views and the collection tree, one tree. */
export function LibrarySidebar({ onFilesDrop }: { onFilesDrop: FilesDropHandler }) {
  const items = useItems().data ?? NO_ITEMS;
  const { model } = useOrganize();
  const chosen = useLibrary((s) => s.scope);
  const scope = useMemo(() => resolveScope(model, chosen), [model, chosen]);
  const reader = useShell((s) => s.view.kind === 'reader');
  const now = useNow().getTime();
  const hasRecent = useMemo(() => recentItems(items, now).length > 0, [items, now]);
  const specials = useMemo(() => visibleSpecials({ itemCount: items.length, hasRecent, model, current: scope.kind }), [items.length, hasRecent, model, scope.kind]);
  const { expanded, settled } = useExpanded(model);
  const rowSize = ROW_HEIGHT[usePrefs().data?.density ?? defaultDensity];
  const { dragAndDropHooks } = useSidebarDnd(onFilesDrop);
  return <SidebarTree model={model} scope={scope} specials={specials} settled={settled} expanded={expanded} reader={reader} rowSize={rowSize} dragAndDropHooks={dragAndDropHooks} />;
}
