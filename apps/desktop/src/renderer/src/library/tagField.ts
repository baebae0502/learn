import type { OrganizeModel } from '../organize/model';
import { NO_TAG_NAMES, type TagNames } from './search';

const byModel = new WeakMap<OrganizeModel, TagNames>();
/**
 * The map handed out last. A model built again from the same tags and assignments (every collection edit renews the
 * snapshot) gets it back, so the search index, which is keyed on the map, is not built again for a change that cannot
 * alter what a query finds.
 */
let last: TagNames = NO_TAG_NAMES;

function sameNames(a: TagNames, b: TagNames): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, names] of a) if (b.get(id) !== names) return false;
  return true;
}

/**
 * Each tagged item's tag names, joined by a space, in the model's tag order (spec 7.1): the search index's last short
 * field. Only items in the list are in it (the model's `tagItems` counts those, P-7). No model yet is no tags.
 */
export function tagNamesFor(model: OrganizeModel | undefined): TagNames {
  if (model === undefined) return NO_TAG_NAMES;
  const known = byModel.get(model);
  if (known) return known;
  const lists = new Map<string, string[]>();
  for (const tag of model.tags) {
    for (const id of model.tagItems(tag.id)) {
      const names = lists.get(id);
      if (names) names.push(tag.name);
      else lists.set(id, [tag.name]);
    }
  }
  const built = new Map<string, string>();
  for (const [id, names] of lists) built.set(id, names.join(' '));
  const result = sameNames(last, built) ? last : built;
  last = result;
  byModel.set(model, result);
  return result;
}
