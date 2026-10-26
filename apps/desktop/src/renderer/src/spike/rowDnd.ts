// Row drag source and tag drop target on a table row (RAC useDrag / useDrop, public API only). Branch m5-spike only.
import { useRef, useSyncExternalStore, type HTMLAttributes, type RefObject } from 'react';
import { useDrag, useDrop } from 'react-aria-components';
import { bridge, itemsPayload } from './bridge';
import { MIME_ITEMS, MIME_TAG } from './data';

/** &rowdrop=always: rows always take drops (the failing baseline for Finder files over rows). */
const ROWDROP = new URLSearchParams(location.search).get('rowdrop');

type Preview = (items: Array<Record<string, string>>, done: (node: HTMLElement | null, x?: number, y?: number) => void) => void;

/** The drag preview (spec 8.2): the first row's title and, from two items on, a "자료 N개" badge. */
const renderPreview: Preview = (items, done) => {
  const t0 = performance.now();
  const ids = (JSON.parse(items[0]![MIME_ITEMS]!) as { itemIds: string[] }).itemIds;
  const node = document.createElement('div');
  node.className = 'dnd-preview';
  node.dataset['testid'] = 'drag-preview';
  node.innerHTML = `<span class="dnd-preview-title"></span>${ids.length > 1 ? '<span class="dnd-preview-badge"></span>' : ''}`;
  node.querySelector('.dnd-preview-title')!.textContent = (window as unknown as { __titleOf?: (id: string) => string }).__titleOf?.(ids[0]!) ?? ids[0]!;
  const badge = node.querySelector('.dnd-preview-badge');
  if (badge) badge.textContent = `자료 ${ids.length}개`;
  bridge.previews.push({ title: node.querySelector('.dnd-preview-title')!.textContent!, badge: badge?.textContent ?? null });
  document.body.append(node);
  done(node, 12, 12);
  setTimeout(() => node.remove(), 0);
  const rec = bridge.starts[bridge.starts.length - 1]!;
  rec.preview = performance.now() - t0;
  rec.doneAt = performance.now();
  rec.pointerToDone = rec.doneAt - rec.moveAt;
  bridge.log.push(`preview ${performance.now()}`);
};

export function useRowDnd(ref: RefObject<HTMLElement | null>, itemId: string): { rowProps: HTMLAttributes<HTMLElement>; isDropTarget: boolean } {
  const preview = useRef<Preview>(renderPreview);
  const { dragProps } = useDrag({
    // Without this, RAC's keyboard drag takes Enter on the row (keydown stopped, keyup starts a drag): ↩ would not open.
    hasDragButton: true,
    preview,
    getAllowedDropOperations: () => ['copy', 'move'],
    getItems: () => {
      const t0 = performance.now();
      const ids = bridge.dragItems(itemId);
      const items = [itemsPayload(ids)];
      bridge.starts.push({ ids: ids.length, getItems: performance.now() - t0, preview: 0, pointerToDone: 0, moveAt: bridge.lastPointerMove, doneAt: 0 });
      return items;
    },
    onDragStart: () => void (bridge.draggingRowId = itemId),
    onDragEnd: (e) => {
      bridge.ends.push({ at: performance.now(), op: e.dropOperation });
      bridge.draggingRowId = null;
    },
  });
  const tagDragging = useSyncExternalStore(bridge.subscribe, () => bridge.tagDragging);
  const { dropProps, isDropTarget } = useDrop({
    ref,
    isDisabled: !tagDragging && ROWDROP !== 'always',
    getDropOperation: (types) => (types.has(MIME_TAG) ? 'copy' : 'cancel'),
    onDrop: async (e) => {
      bridge.dropMs.push(performance.now() - bridge.dropStart);
      const item = e.items.find((i) => i.kind === 'text' && i.types.has(MIME_TAG));
      if (!item || item.kind !== 'text') return;
      const { tagId } = JSON.parse(await item.getText(MIME_TAG)) as { tagId: string };
      bridge.tagDrops.push({ tagId, rowId: itemId, applied: bridge.dragItems(itemId) });
    },
  });
  return { rowProps: { ...dragProps, ...dropProps } as HTMLAttributes<HTMLElement>, isDropTarget };
}
