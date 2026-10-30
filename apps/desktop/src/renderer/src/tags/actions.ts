import { api, unwrap } from '../api';
import { currentModel, patchOrganize } from '../sidebar/actions';
import { useLibrary } from '../state/library-store';
import { showActionFailed, showToast } from '../ui/toasts';
import { createTagActions } from './tagActions';

/** The window's tag actions: the selector, the registry's handlers and the 1–8 keys share them. */
export const tagActions = createTagActions({
  tags: {
    rename: (input) => unwrap(api().tags.rename(input)),
    setColor: (input) => unwrap(api().tags.setColor(input)),
    remove: (input) => unwrap(api().tags.remove(input)),
    assign: (input) => unwrap(api().tags.assign(input)),
    unassign: (input) => unwrap(api().tags.unassign(input)),
    togglePosition: (input) => unwrap(api().tags.togglePosition(input)),
  },
  confirm: (input) => unwrap(api().ui.confirm(input)),
  model: currentModel,
  patch: patchOrganize,
  leaveFilter: (tagId, into) => useLibrary.getState().dropFromTagFilter(tagId, into),
  opener: () => document.activeElement,
  failed: showActionFailed,
  notice: (title) => showToast({ kind: 'info', title, testId: 'tag-notice' }),
});
