import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { LIST_REFRESH_WAIT_MS, settledWithin } from '../library/import-flow';
import { currentModel, collectionActions } from '../sidebar/actions';
import { useLibrary } from '../state/library-store';
import { showActionFailed, showUndoToast, showUndoableError } from '../ui/toasts';
import { trashActions } from '../trash/actions';
import { createDuplicateActions } from './duplicateActions';
import { addItemsTo, removeFromScope, undoRemovals } from './membership';
import { createMembershipCommands } from './membershipCommands';

/** The window's membership commands (the registry env and the item panel share them). */
export const membershipCommands = createMembershipCommands({
  model: currentModel,
  scope: () => useLibrary.getState().scope,
  addItemsTo,
  removeFromScope,
  undoRemovals,
  startNew: (opts) => collectionActions.startNew(opts),
  undoToast: showUndoToast,
  failed: showActionFailed,
  failedWithUndo: showUndoableError,
});

/** 하나만 남기고 휴지통으로 and 중복 N묶음 모두 정리 (the registry env runs them). */
export const duplicateActions = createDuplicateActions({
  keepOne: (itemIds) => unwrap(api().library.keepOneOfDuplicates({ itemIds: [...itemIds] })),
  keepAll: () => unwrap(api().library.keepOneOfAllDuplicates()),
  undo: (token) => unwrap(api().library.undoKeepOne(token)),
  model: currentModel,
  scope: () => useLibrary.getState().scope,
  setScope: (scope) => useLibrary.getState().setScope(scope),
  settled: () => settledWithin(queryClient.refetchQueries({ queryKey: keys.items, type: 'active' }, { cancelRefetch: false }), LIST_REFRESH_WAIT_MS),
  undoToast: (title, undo) => showUndoToast(title, undo),
  trackUndo: trashActions.trackUndo,
  failed: showActionFailed,
});
