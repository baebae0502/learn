import { useDrag } from 'react-aria-components';
import { dragState, useDndGate } from './dragState';
import { tagDrag } from './mime';

/** A tag chip as a drag source (spec 8.3): a copy of the tag onto rows. `hasDragButton` keeps a press a press (it toggles the filter) and a synthetic mouse a native drag. */
export function useChipDrag(tag: { id: string; name: string }) {
  const open = useDndGate();
  return useDrag({
    isDisabled: !open,
    hasDragButton: true,
    getItems: () => [tagDrag(tag)],
    getAllowedDropOperations: () => ['copy'],
    onDragStart: () => dragState.beginTag(tag.id),
    onDragEnd: () => dragState.endUnlessNative(),
  });
}
