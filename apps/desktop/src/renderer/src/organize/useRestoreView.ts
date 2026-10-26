import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api';
import { keys, useItems } from '../data/queries';
import { useLibrary } from '../state/library-store';
import { restorableScope } from './scope';
import { useOrganize } from './useOrganize';

/**
 * Opens the view stored in `library.view` once, when everything it is judged by has answered — the setting, the organize
 * snapshot and the item list (success or failure: a failed read cannot confirm a collection, so the view opens at `all`).
 * Until then the library store is not ready and the table is not drawn. Returns whether the store is ready.
 */
export function useRestoreView(): boolean {
  const ready = useLibrary((s) => s.scopeReady);
  const view = useQuery({ queryKey: keys.view, queryFn: () => unwrap(api().settings.get({ key: 'library.view' })), enabled: !ready });
  const items = useItems();
  const { model, settled } = useOrganize();
  const answered = (view.isSuccess || view.isError) && (items.isSuccess || items.isError) && settled;
  useEffect(() => {
    if (ready || !answered) return;
    useLibrary.getState().restoreScope(restorableScope(view.data ?? null, model, items.data ?? [], Date.now()));
  }, [ready, answered, view.data, model, items.data]);
  return ready;
}
