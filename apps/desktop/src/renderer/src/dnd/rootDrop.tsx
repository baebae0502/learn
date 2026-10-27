import { useRef, type ReactNode } from 'react';
import { useDrop, type TextDropItem } from 'react-aria-components';
import { currentModel } from '../sidebar/actions';
import { dropActions } from './actions';
import { dragState, useDndGate } from './dragState';
import { MIME_COLLECTION, parseCollectionPayload } from './mime';
import { collectionOnCollection } from './rules';

/**
 * The 컬렉션 heading as a drop target (spec 8.3): a collection dropped on it becomes a top-level one. A plain drop target of
 * its own, outside the tree's: the keyboard drag finds it among its targets too.
 */
export function RootDropArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const open = useDndGate();
  const { dropProps, isDropTarget } = useDrop({
    ref,
    isDisabled: !open,
    getDropOperation: (types) => (types.has(MIME_COLLECTION) ? collectionOnCollection({ dragged: dragState.get().collectionId, target: null, model: currentModel() }) : 'cancel'),
    onDrop: async (e) => {
      const item = e.items.find((i): i is TextDropItem => i.kind === 'text' && i.types.has(MIME_COLLECTION));
      const id = item ? parseCollectionPayload(await item.getText(MIME_COLLECTION)) : null;
      if (id) await dropActions.collectionOn(id, null);
    },
  });
  return (
    <div ref={ref} {...dropProps} className="heading-drop" data-testid="collections-heading-drop" data-drop-target={isDropTarget || undefined}>
      {children}
    </div>
  );
}
