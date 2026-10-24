import { revealInspector } from '../shell/useInspector';
import { useLibrary } from '../state/library-store';
import { afterEditing, editSession } from './editGuard';
import { useSections } from './sections';

let focusFor: string | null = null;

/** InfoEditor asks when it mounts: true once after 정보 편집 asked for this item (its title field then takes the focus). */
export function takeFocusRequest(itemId: string): boolean {
  const asked = focusFor === itemId;
  focusFor = null;
  return asked;
}

/** 정보 편집 (item.editInfo, the pencil): the panel shows if it is out of sight, 정보 opens, its form takes the focus. */
export function startEditing(itemId: string): void {
  const begin = () => {
    revealInspector();
    useSections.getState().setOpen('info', true);
    if (useLibrary.getState().editingId === itemId) {
      // Already open (the palette again): only the focus moves.
      document.querySelector<HTMLElement>('[data-testid="editor-field"][data-field="title"] input')?.focus();
      return;
    }
    focusFor = itemId;
    useLibrary.getState().setEditing(itemId);
  };
  const open = editSession();
  if (open && open.itemId !== itemId) afterEditing(begin);
  else begin();
}
