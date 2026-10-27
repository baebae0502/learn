import type { StorageMode } from '@learn/domain';
import { useDragAndDrop, type DragTypes, type DropOperation, type DropTarget, type DroppableCollectionOnItemDropEvent } from 'react-aria-components';
import { api } from '../api';
import { currentModel } from '../sidebar/actions';
import { importTarget, type ImportTarget } from '../sidebar/importTarget';
import { useSidebarEdit } from '../sidebar/sidebarEdit';
import { dropActions, viewedScope } from './actions';
import { dragState, useDndGate } from './dragState';
import { filesFromDrop } from './fileDrop';
import { MIME_COLLECTION, MIME_ITEMS, MIME_TAG, collectionDrag, parseCollectionPayload, parseItemsPayload } from './mime';
import { collectionOnCollection, filesOnRow, inertRow, itemsOnCollection } from './rules';

/** What the sidebar does with files dropped on a row: MainWindow's drop, told where they go (a collection, or null for 내 라이브러리). */
export type FilesDropHandler = (paths: string[], mode: StorageMode, unresolved: number, into: ImportTarget | null) => void;

/** The collection whose name is being typed, if any: with the draft row it takes no part in drag and drop. */
function renamingKey(): string | null {
  const edit = useSidebarEdit.getState().edit;
  return edit?.kind === 'rename' ? edit.id : null;
}

/**
 * The drop target under the pointer, found from the rows on screen. Under a Virtualizer React Aria picks the nearest edge of
 * the layout boxes at the pointer, and the box of a section ends where its last row does: in the lower half of the last row
 * of a section the section is as near as the row and wins, so that row would take drops over its upper half only (a section
 * is no drop target). Rows are the only targets, each over its whole height; anything else is the root, which refuses.
 */
type TargetDelegate = NonNullable<Parameters<typeof useDragAndDrop>[0]['dropTargetDelegate']>;
export const rowTargets: TargetDelegate = {
  getDropTargetFromPoint(_x, y) {
    const tree = document.querySelector<HTMLElement>('.sidebar-tree');
    if (!tree) return { type: 'root' };
    const at = tree.getBoundingClientRect().top + y; // y is relative to the tree's top edge
    for (const row of tree.querySelectorAll<HTMLElement>('[role="row"][data-key]')) {
      const box = row.getBoundingClientRect();
      if (at >= box.top && at < box.bottom) return { type: 'item', key: row.dataset['key']!, dropPosition: 'on' };
    }
    return { type: 'root' };
  },
};

/** The row a drag is over is the one a drop will be on: its focus move is guarded from then on (dragState.hoverDropFocus), until the drag leaves it. */
function armOver(target: DropTarget): void {
  if (target.type === 'item' && target.dropPosition === 'on') dragState.hoverDropFocus(String(target.key));
}
function leaveOver(target: DropTarget): void {
  if (target.type === 'item') dragState.leaveDropFocus(String(target.key));
}

/** What the tree answers while a drag is over a row (rules.ts has the reasons). */
export function treeDropOperation(target: DropTarget, types: DragTypes, allowed: DropOperation[]): DropOperation {
  // Only "on" a row: the tree also offers "between" targets, which it never takes — a collection's place is its name's.
  if (target.type !== 'item' || target.dropPosition !== 'on') return 'cancel';
  const key = String(target.key);
  if (inertRow(key, renamingKey())) return 'cancel'; // the draft row and the row being named: no item, collection, tag or file
  const model = currentModel();
  if (dragState.filesOver()) {
    if (filesOnRow(key, model) === null) return 'cancel';
    return allowed.includes('copy') ? 'copy' : (allowed[0] ?? 'cancel'); // ⌥ and the move key narrow what is allowed, not whether files drop
  }
  if (types.has(MIME_COLLECTION)) return collectionOnCollection({ dragged: dragState.get().collectionId, target: key, model });
  if (types.has(MIME_ITEMS)) return itemsOnCollection({ target: key, model, scope: viewedScope(), itemIds: dragState.get().itemIds, allowed });
  return 'cancel'; // a tag chip drops on table rows only
}

async function onItemDrop(e: DroppableCollectionOnItemDropEvent, onFiles: FilesDropHandler): Promise<void> {
  const key = String(e.target.key);
  dragState.armDropFocus(key);
  const alt = dragState.alt(); // read before any wait: the next event may change it
  const first = e.items[0];
  if (first?.kind === 'text') {
    if (first.types.has(MIME_COLLECTION)) {
      const id = parseCollectionPayload(await first.getText(MIME_COLLECTION));
      if (id) await dropActions.collectionOn(id, key);
    } else if (first.types.has(MIME_ITEMS)) {
      const ids = parseItemsPayload(await first.getText(MIME_ITEMS));
      if (ids) await dropActions.itemsOn(key, ids, e.dropOperation);
    }
    return;
  }
  const model = currentModel();
  const target = filesOnRow(key, model);
  if (!target) return;
  const { paths, unresolved } = await filesFromDrop(e.items, (file) => api().pathForFile(file));
  onFiles(paths, alt ? 'linked' : 'managed', unresolved, target.kind === 'collection' ? importTarget(model, { kind: 'all' }, target.id) : null);
}

/**
 * The tree's drag and drop (spec 8.2–8.4): a collection row is a source (moving it) and every collection row, and
 * 내 라이브러리 for files, is a target. React Aria's own spring-loading (800 ms) and edge scrolling (20 px) are used as
 * they are: passing `onDropActivate` would replace the spring.
 */
export function useSidebarDnd(onFiles: FilesDropHandler) {
  const open = useDndGate();
  return useDragAndDrop({
    isDisabled: !open,
    dropTargetDelegate: rowTargets,
    getItems: (keys) =>
      [...keys].flatMap((key) => {
        const node = inertRow(String(key), renamingKey()) ? undefined : currentModel()?.node(String(key));
        return node ? [collectionDrag(node)] : [];
      }),
    getAllowedDropOperations: () => ['move'],
    onDragStart: (e) => dragState.beginCollection(String([...e.keys][0])),
    onDragEnd: () => dragState.endUnlessNative(),
    acceptedDragTypes: 'all',
    getDropOperation: treeDropOperation,
    onItemDrop: (e) => void onItemDrop(e, onFiles),
    onDropEnter: (e) => armOver(e.target),
    onDropExit: (e) => leaveOver(e.target),
  });
}
