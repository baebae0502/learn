import { commonCollections } from '../organize/common';
import type { OrganizeModel } from '../organize/model';

/** One line of the collection section: the collection and the names from the top of its tree down to it. */
export interface PathRow {
  id: string;
  names: string[];
}

/**
 * The collection section's rows (spec 6.1, 6.2): the collections a single item is directly in, or the ones all of several
 * are directly in — in tree order either way, each with its path ("분자생물학 › 6장 · 신호 전달").
 */
export function pathRows(model: OrganizeModel, ids: readonly string[]): PathRow[] {
  return commonCollections(model, ids).map((id) => ({ id, names: model.path(id).map((node) => node.name) }));
}
