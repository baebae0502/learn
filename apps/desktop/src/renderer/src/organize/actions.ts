import { currentModel, collectionActions } from '../sidebar/actions';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { showToast, showUndoToast } from '../ui/toasts';
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
  failed: (e) => showToast({ kind: 'error', title: t.toast.actionFailed, body: e instanceof Error ? e.message : undefined, testId: 'action-error' }),
});
