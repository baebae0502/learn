import { commandById } from '@learn/domain';
import { commonCollections } from '../organize/common';
import type { OrganizeModel } from '../organize/model';
import { t } from '../strings';
import type { MenuButtonItem, MenuEntry } from '../ui/MenuButton';

/** A collection row's key is `c:<id>`; the last row is `new`. */
export type AddMenuKey = `c:${string}` | 'new';
export const collectionOfKey = (key: AddMenuKey): string | null => (key.startsWith('c:') ? key.slice(2) : null);

/**
 * The web menu of 컬렉션에 추가 ▾ (spec 6.2, design-spec 7.3): the collections in tree order with their depth, a
 * separator, 새 컬렉션 ⇧⌘N. A collection that already holds every selected item is marked and disabled.
 */
export function addToCollectionEntries(model: OrganizeModel, ids: readonly string[]): MenuEntry<AddMenuKey>[] {
  const holding = new Set(commonCollections(model, ids));
  const rows: MenuButtonItem<AddMenuKey>[] = model.flat.map((node) => ({
    id: `c:${node.id}`,
    label: node.name,
    indent: node.depth,
    marked: holding.has(node.id),
    isDisabled: holding.has(node.id),
    testId: `add-to-collection-${node.id}`,
  }));
  const create: MenuButtonItem<AddMenuKey> = { id: 'new', label: t.organize.panel.newCollection, accelerator: commandById('collection.new').accelerator, testId: 'add-to-collection-new' };
  // The collections are a section of their own: their marks make it a group of checkboxes, and 새 컬렉션 stays an action.
  return rows.length === 0 ? [create] : [{ items: rows }, { separator: true }, create];
}
