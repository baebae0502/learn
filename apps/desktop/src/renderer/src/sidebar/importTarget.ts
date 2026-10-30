import type { LibraryScope } from '@learn/domain';
import type { OrganizeModel } from '../organize/model';

export interface ImportTarget {
  id: string;
  name: string;
}

/**
 * The collection an import files into (spec 3.7): `into` undefined = the one being viewed, null = none, an id = that one
 * (a menu row's choice). Anything that is not a live collection of the snapshot is none — the library and the special
 * views never take imports.
 */
export function importTarget(model: OrganizeModel | undefined, scope: LibraryScope, into: string | null | undefined): ImportTarget | null {
  const id = into === undefined ? (scope.kind === 'collection' ? scope.id : null) : into;
  if (id === null) return null;
  const node = model?.node(id);
  return node ? { id: node.id, name: node.name } : null;
}
