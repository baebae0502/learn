import type { LibraryScope } from '@learn/domain';
import { api, unwrap } from '../api';
import { attachTag } from '../organize/itemTags';
import { addItemsTo, removeFromScope, undoAdds, undoRemovals } from '../organize/membership';
import { resolveScope } from '../organize/scope';
import { addExpanded, currentModel, patchOrganize } from '../sidebar/actions';
import { ancestorIds } from '../sidebar/rows';
import { useLibrary } from '../state/library-store';
import { perfMark } from '../ui/perfMarks';
import { showActionFailed, showUndoToast } from '../ui/toasts';
import { dragState } from './dragState';
import { createDropActions } from './drops';
import { tagOnRow } from './rules';

/** The view shown now: what the user chose, or `all` while the chosen collection is gone. */
export const viewedScope = (): LibraryScope => resolveScope(currentModel(), useLibrary.getState().scope);

/** The window's drop actions (the table's rows, the sidebar and its heading share them). */
export const dropActions = createDropActions({
  model: currentModel,
  scope: viewedScope,
  selected: () => useLibrary.getState().selected,
  addItemsTo,
  removeFromScope,
  undoRemovals,
  undoAdds,
  moveCollection: (input) => unwrap(api().collections.move(input)),
  patch: patchOrganize,
  reveal: (collectionId) => {
    const model = currentModel();
    if (model) addExpanded(ancestorIds(model, collectionId));
  },
  attachTag,
  undoToast: showUndoToast,
  failed: showActionFailed,
  mark: perfMark,
});

/** The items a tag being dragged would go on if dropped on this row, or null: the row's marker asks this. */
export function tagDropIds(rowId: string): string[] | null {
  return tagOnRow({ tagId: dragState.get().tagId, rowId, selected: useLibrary.getState().selected, model: currentModel() });
}
