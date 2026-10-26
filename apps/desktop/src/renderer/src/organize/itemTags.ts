import type { OrganizeTag, Tag } from '@learn/domain';
import { api, unwrap } from '../api';
import { inChunks } from './membership';
import { patchSnapshot } from './snapshotCache';
import { withTagged } from '../tags/organizeCache';
import { withTag } from './snapshotPatch';

/** A tag the user chose in the add field, or the name they typed. */
export type TagPick = { tag: OrganizeTag } | { name: string };

const organizeTag = (t: Tag): OrganizeTag => ({ id: t.id, name: t.name, color: t.color, position: t.position });

/**
 * Puts a tag on items (spec 6.1, 6.2). A typed name goes through `tags:create`, which answers the tag of that name when
 * there is one (NFC, any case), so typing a name that exists attaches it. The tag joins the snapshot as soon as it exists,
 * so a refused `assign` after it leaves the picture true.
 */
export async function attachTag(itemIds: readonly string[], pick: TagPick): Promise<OrganizeTag> {
  const ids = [...new Set(itemIds)];
  const tag = 'tag' in pick ? pick.tag : organizeTag(await unwrap(api().tags.create({ name: pick.name })));
  patchSnapshot((s) => withTag(s, tag));
  for (const chunk of inChunks(ids)) await unwrap(api().tags.assign({ tagId: tag.id, itemIds: chunk }));
  patchSnapshot((s) => withTagged(s, tag.id, ids, true));
  return tag;
}

/** Takes a tag off items (the chip's × and ⌫; from all of a selection for a common tag). */
export async function detachTag(itemIds: readonly string[], tagId: string): Promise<void> {
  const ids = [...new Set(itemIds)];
  for (const chunk of inChunks(ids)) await unwrap(api().tags.unassign({ tagId, itemIds: chunk }));
  patchSnapshot((s) => withTagged(s, tagId, ids, false));
}
