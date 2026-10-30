import { useRef, type HTMLAttributes, type RefObject } from 'react';
import { useDrag, useDrop, type TextDropItem } from 'react-aria-components';
import { dropActions, tagDropIds } from './actions';
import { dragState, useDndGate, useTagDragging } from './dragState';
import { MIME_TAG, itemsDrag, parseTagPayload } from './mime';
import { renderRowPreview } from './rowPreview';

/**
 * A table row as a drag source (the rows it takes: `dragIdsOf`) and, while a tag chip is being dragged, as a drop target
 * (spec 8.2, 8.3). React Aria's `useDrag` with `hasDragButton`: without it React Aria takes ↩ on the row (the table opens it
 * with that key) and reads a synthetic mouse press as a virtual one, so no native drag starts. The row has no drag button
 * — the keyboard's way to file items is 컬렉션에 추가 ▸.
 */
export function useRowDnd(ref: RefObject<HTMLElement | null>, itemId: string, dragIdsOf: (rowId: string) => string[]): { rowProps: HTMLAttributes<HTMLElement>; isDropTarget: boolean } {
  const open = useDndGate();
  const tagDragging = useTagDragging();
  const preview = useRef(renderRowPreview);
  const { dragProps } = useDrag({
    isDisabled: !open,
    hasDragButton: true,
    preview,
    getAllowedDropOperations: () => ['copy', 'move'],
    onDragStart: () => dragState.beginItems(dragIdsOf(itemId)),
    getItems: () => [itemsDrag(dragState.get().itemIds)],
    onDragEnd: () => dragState.endUnlessNative(),
  });
  const { dropProps, isDropTarget } = useDrop({
    ref,
    // A row that takes drops all the time swallows every dragover, Finder's files too: the window overlay would never show over the table.
    isDisabled: !open || !tagDragging,
    getDropOperation: (types) => (types.has(MIME_TAG) && tagDropIds(itemId) !== null ? 'copy' : 'cancel'),
    onDrop: async (e) => {
      const item = e.items.find((i): i is TextDropItem => i.kind === 'text' && i.types.has(MIME_TAG));
      const tagId = item ? parseTagPayload(await item.getText(MIME_TAG)) : null;
      if (tagId) await dropActions.tagOn(tagId, itemId);
    },
  });
  return { rowProps: { ...dragProps, ...dropProps } as HTMLAttributes<HTMLElement>, isDropTarget };
}
