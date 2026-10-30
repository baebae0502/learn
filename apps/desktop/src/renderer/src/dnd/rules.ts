import type { LibraryScope } from '@learn/domain';
import type { OrganizeModel } from '../organize/model';
import { DRAFT_KEY, SCOPE_KEYS } from '../sidebar/rows';

/** What a drop target answers to React Aria: nothing (no marker, no drop), an add (copy) or a move. */
export type DropVerdict = 'cancel' | 'copy' | 'move';

/**
 * Rows onto the collection row `target` (spec 8.2). `allowed` is what React Aria lets through now, which the move key
 * (⌘ on macOS, Shift elsewhere) narrows to `move` alone. Outside a collection the key moves nothing, but the answer
 * stays `move`: React Aria turns an operation it did not allow into `cancel`, and a copy would show no target at all —
 * the drop handler decides by the view, so there it only adds.
 */
export function itemsOnCollection(input: { target: string; model: OrganizeModel | undefined; scope: LibraryScope; itemIds: readonly string[]; allowed: readonly string[] }): DropVerdict {
  const { target, model, scope, itemIds, allowed } = input;
  if (!model?.node(target)) return 'cancel'; // a special view, the row being named, a collection gone since
  if (scope.kind === 'collection' && scope.id === target) return 'cancel'; // where the rows already are
  const moveKey = allowed.length === 1 && allowed[0] === 'move';
  if (moveKey && scope.kind === 'collection') return 'move'; // also into a descendant that holds them: they leave the rest
  if (itemIds.length > 0 && itemIds.every((id) => model.directCollectionsOf(id).includes(target))) return 'cancel'; // nothing to add
  if (moveKey) return 'move';
  return allowed.includes('copy') ? 'copy' : 'cancel';
}

/** A collection onto a collection row, or (target null) onto the 컬렉션 heading, which is the top level (spec 8.3). */
export function collectionOnCollection(input: { dragged: string | null; target: string | null; model: OrganizeModel | undefined }): 'cancel' | 'move' {
  const { dragged, target, model } = input;
  const node = dragged === null ? undefined : model?.node(dragged);
  if (!model || !node) return 'cancel';
  if (target === null) return node.parentId === null ? 'cancel' : 'move';
  if (!model.node(target)) return 'cancel';
  if (node.parentId === target) return 'cancel'; // already there
  if (model.path(target).some((n) => n.id === dragged)) return 'cancel'; // itself or below itself: a cycle
  return 'move';
}

/**
 * The items a tag dropped on the table row `rowId` goes on (spec 8.3): the whole selection when the row is in it, else
 * the row alone — and none, so no marker, when all of them have the tag already.
 */
export function tagOnRow(input: { tagId: string | null; rowId: string; selected: ReadonlySet<string>; model: OrganizeModel | undefined }): string[] | null {
  const { tagId, rowId, selected, model } = input;
  if (tagId === null || !model || !model.tags.some((x) => x.id === tagId)) return null;
  const ids = selected.has(rowId) ? [...selected] : [rowId];
  const held = model.tagItems(tagId);
  return ids.every((id) => held.has(id)) ? null : ids;
}

/** Where Finder's files dropped on a sidebar row go (spec 8.4): none on the other special views. */
export function filesOnRow(target: string, model: OrganizeModel | undefined): { kind: 'library' } | { kind: 'collection'; id: string } | null {
  if (target === SCOPE_KEYS.all) return { kind: 'library' };
  return model?.node(target) ? { kind: 'collection', id: target } : null;
}

/** The draft row (a collection not created yet) and the row whose name is being typed take no part in drag and drop: not a source, not a target. */
export const inertRow = (key: string, editingKey: string | null): boolean => key === DRAFT_KEY || key === editingKey;
