import type { LibraryItem, OrganizeSnapshot } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { organizeModelFor, type OrganizeModel } from '../organize/model';
import { patchSnapshot } from '../organize/snapshotCache';
import { parseExpanded } from '../organize/viewSettings';
import { sidebarHidden, toggledSidebar } from '../shell/layout';
import { useLibrary } from '../state/library-store';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { showToast, showUndoToast } from '../ui/toasts';
import { createCollectionActions } from './collectionActions';
import { saveExpanded } from './useExpanded';

/** The model of the snapshot and the list the cache holds now (the same instance while neither changed). */
export function currentModel(): OrganizeModel | undefined {
  const snapshot = queryClient.getQueryData<OrganizeSnapshot>(keys.organize);
  const items = queryClient.getQueryData<LibraryItem[]>(keys.items);
  return snapshot && items ? organizeModelFor(snapshot, items) : undefined;
}

/** Changes the organize snapshot in the cache (the notice main sends next brings the real one). */
export const patchOrganize = patchSnapshot;

/** Opens these collections' rows (and remembers it): the stored list plus the new ones. */
export function addExpanded(ids: readonly string[]): void {
  const model = currentModel();
  const known = (id: string) => model?.node(id) !== undefined;
  const open = new Set(parseExpanded(queryClient.getQueryData(keys.expanded), known));
  if (ids.every((id) => open.has(id))) return;
  saveExpanded(new Set([...open, ...ids.filter(known)]));
}

/** Takes these collections out of the stored open rows: one deleted and then restored comes back folded. */
function forgetExpanded(ids: readonly string[]): void {
  const open = new Set(parseExpanded(queryClient.getQueryData(keys.expanded), () => true));
  if (!ids.some((id) => open.has(id))) return;
  for (const id of ids) open.delete(id);
  saveExpanded(open);
}

function showSidebar(): void {
  const { sidebar, setSidebar } = useShell.getState();
  if (sidebarHidden(sidebar, innerWidth)) setSidebar(toggledSidebar(sidebar, innerWidth));
}

/** The window's collection actions (the sidebar and the command registry share them). */
export const collectionActions = createCollectionActions({
  collections: {
    create: (input) => unwrap(api().collections.create(input)),
    rename: (input) => unwrap(api().collections.rename(input)),
    remove: (input) => unwrap(api().collections.remove(input)),
    restore: (input) => unwrap(api().collections.restore(input)),
  },
  confirm: (input) => unwrap(api().ui.confirm(input)),
  model: currentModel,
  scope: () => useLibrary.getState().scope,
  setScope: (scope) => useLibrary.getState().setScope(scope),
  patch: patchOrganize,
  expand: addExpanded,
  forget: forgetExpanded,
  showSidebar,
  opener: () => document.activeElement,
  failed: (e) => showToast({ kind: 'error', title: t.toast.actionFailed, body: e instanceof Error ? e.message : undefined, testId: 'action-error' }),
  undoToast: showUndoToast,
});
