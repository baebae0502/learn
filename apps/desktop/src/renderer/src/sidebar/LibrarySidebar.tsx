import { useMemo } from 'react';
import { useItems, usePrefs } from '../data/queries';
import { useSidebarDnd, type FilesDropHandler } from '../dnd/treeDnd';
import { defaultDensity, density as ROW_HEIGHT } from '../design/tokens';
import { recentItems, resolveScope } from '../organize/scope';
import { useOrganize } from '../organize/useOrganize';
import { useLibrary } from '../state/library-store';
import { useNow } from '../useNow';
import { SidebarTree } from './SidebarTree';
import { visibleSpecials } from './rows';
import { useExpanded } from './useExpanded';
import { LibrarySessions, recentGroups, useRecentSessions } from './LibrarySessions';

const NO_ITEMS: readonly never[] = [];

/** The library's navigator in the sidebar (spec 3.2–3.4): the special views and the collection tree, one tree; the tutor's sessions under them. */
export function LibrarySidebar({ onFilesDrop }: { onFilesDrop: FilesDropHandler }) {
  const items = useItems().data ?? NO_ITEMS;
  const { model } = useOrganize();
  const chosen = useLibrary((s) => s.scope);
  const scope = useMemo(() => resolveScope(model, chosen), [model, chosen]);
  const now = useNow().getTime();
  const hasRecent = useMemo(() => recentItems(items, now).length > 0, [items, now]);
  const specials = useMemo(() => visibleSpecials({ itemCount: items.length, hasRecent, model, current: scope.kind }), [items.length, hasRecent, model, scope.kind]);
  const { expanded, settled } = useExpanded(model);
  const rowSize = ROW_HEIGHT[usePrefs().data?.density ?? defaultDensity];
  const { dragAndDropHooks } = useSidebarDnd(onFilesDrop);
  // The tutor's sessions, a section of their own under the collections (T1a spec 8.9): none, no section.
  const recent = useRecentSessions().data;
  const sessions = useMemo(() => recentGroups(recent), [recent]);
  return (
    <SidebarTree
      model={model}
      scope={scope}
      specials={specials}
      settled={settled}
      expanded={expanded}
      rowSize={rowSize}
      dragAndDropHooks={dragAndDropHooks}
      after={sessions.length > 0 ? <LibrarySessions groups={sessions} /> : undefined}
    />
  );
}
