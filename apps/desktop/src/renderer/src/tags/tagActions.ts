import type { OrganizeSnapshot, Tag, TagColorId } from '@learn/domain';
import type { OrganizeModel } from '../organize/model';
import { t } from '../strings';
import { withTagColor, withTagMerged, withTagRemoved, withTagRenamed, withTagged } from './organizeCache';
import { tagColorId } from './tagColor';
import { useTagEdit } from './tagEdit';
import { sameTagName, tagNameVerdict } from './tagName';

/** tags:togglePosition, tags:assign and tags:unassign take at most this many items (D/ipc.ts). */
export const TOGGLE_CHUNK = 5000;

/** Everything the tag actions touch outside themselves, so they run in a test without a window. */
export interface TagActionDeps {
  tags: {
    rename(input: { tagId: string; name: string }): Promise<Tag>;
    setColor(input: { tagId: string; color: TagColorId | null; position: number | null }): Promise<Tag>;
    remove(input: { tagId: string }): Promise<void>;
    assign(input: { tagId: string; itemIds: string[] }): Promise<number>;
    unassign(input: { tagId: string; itemIds: string[] }): Promise<number>;
    togglePosition(input: { position: number; itemIds: string[] }): Promise<{ tagId: string; assigned: boolean } | null>;
  };
  /** ui.confirm: the native sheet. */
  confirm(input: { message: string; detail?: string; confirm: string; caution?: boolean }): Promise<boolean>;
  model(): OrganizeModel | undefined;
  /** Changes the organize snapshot in the cache; the notice main sends next brings the real one. */
  patch(update: (s: OrganizeSnapshot) => OrganizeSnapshot): void;
  /** The tag left the filter (deleted, or merged into `into`, which takes its place). */
  leaveFilter(tagId: string, into?: string): void;
  /** What has the focus now. */
  opener(): Element | null;
  failed(e: unknown): void;
  /** A plain message that is not an error (a colour key with no tag at its slot). */
  notice(message: string): void;
}

export interface TagActions {
  /** ↩ on a chip, 이름 바꾸기 in its menu: the chip becomes its name field. */
  startRename(tagId: string): void;
  /**
   * Ends the edit with the text in the field: `enter` (↩) or `blur` (a click elsewhere). A name another tag has asks
   * first and merges; over the limit keeps the edit open on ↩ and drops it on a click.
   */
  finishRename(text: string, how: 'enter' | 'blur'): Promise<void>;
  cancelRename(): void;
  /** 색 지정 ▸ N: colour N is slot N; the tag that held the slot loses both — one call. */
  setColor(tagId: string, position: number): Promise<void>;
  clearColor(tagId: string): Promise<void>;
  /** 태그 삭제…: the sheet, then the delete. No undo (spec 0). */
  remove(tagId: string): Promise<void>;
  /** 1–8: the tag at the slot goes on the items, or off them when all have it. */
  togglePosition(position: number, itemIds: readonly string[]): Promise<void>;
}

export function createTagActions(deps: TagActionDeps): TagActions {
  const edit = () => useTagEdit.getState();
  const tagOf = (tagId: string) => deps.model()?.tags.find((x) => x.id === tagId);

  return {
    startRename(tagId) {
      const tag = tagOf(tagId);
      if (tag) edit().begin(tagId, tag.name, deps.opener());
    },

    async finishRename(text, how) {
      const s = edit();
      const id = s.editingId;
      if (id === null || s.busy) return;
      const model = deps.model();
      const tag = model?.tags.find((x) => x.id === id);
      if (!model || !tag) {
        s.end(false);
        return;
      }
      const verdict = tagNameVerdict(text, tag.name);
      if (verdict.kind === 'tooLong') {
        if (how !== 'enter') s.end(false);
        return;
      }
      if (verdict.kind === 'unchanged') {
        s.end(how === 'enter' ? id : false);
        return;
      }
      s.setBusy(true);
      let restore: string | false = how === 'enter' ? id : false;
      try {
        const clash = model.tags.find((x) => x.id !== id && sameTagName(x.name, verdict.name));
        if (clash) {
          const sure = await deps.confirm({
            message: t.organize.tags.mergeMessage(clash.name),
            detail: t.organize.tags.mergeDetail(tag.name, clash.name),
            confirm: t.organize.tags.mergeConfirm,
          });
          if (!sure) return; // the edit ends below, the old name back
        }
        const saved = await deps.tags.rename({ tagId: id, name: verdict.name });
        if (saved.id === id) deps.patch((snap) => withTagRenamed(snap, id, saved.name));
        else {
          // The database merged (the sheet said so, or the cache lagged): this tag is gone, the other has its items.
          deps.patch((snap) => withTagMerged(snap, id, saved.id));
          deps.leaveFilter(id, saved.id);
          if (restore !== false) restore = saved.id;
        }
      } catch (e) {
        deps.failed(e);
      } finally {
        if (edit().editingId === id) edit().end(restore);
      }
    },

    cancelRename() {
      const s = edit();
      if (s.editingId !== null && !s.busy) s.end();
    },

    async setColor(tagId, position) {
      const tag = tagOf(tagId);
      if (!tag || tag.position === position) return;
      const color = tagColorId(position);
      try {
        await deps.tags.setColor({ tagId, color, position });
        deps.patch((snap) => withTagColor(snap, tagId, color, position));
      } catch (e) {
        deps.failed(e);
      }
    },

    async clearColor(tagId) {
      const tag = tagOf(tagId);
      if (!tag || (tag.position === null && tag.color === null)) return;
      try {
        await deps.tags.setColor({ tagId, color: null, position: null });
        deps.patch((snap) => withTagColor(snap, tagId, null, null));
      } catch (e) {
        deps.failed(e);
      }
    },

    async remove(tagId) {
      const model = deps.model();
      const tag = model?.tags.find((x) => x.id === tagId);
      if (!model || !tag) return;
      const sure = await deps.confirm({
        message: t.organize.tags.deleteMessage(tag.name),
        detail: t.organize.tags.deleteDetail(model.tagItems(tagId).size),
        confirm: t.organize.tags.deleteConfirm,
        caution: true, // no undo: the tag and its place on every item are gone
      });
      if (!sure) return;
      try {
        await deps.tags.remove({ tagId });
      } catch (e) {
        deps.failed(e);
        return;
      }
      deps.patch((snap) => withTagRemoved(snap, tagId));
      deps.leaveFilter(tagId);
    },

    async togglePosition(position, itemIds) {
      const model = deps.model();
      const tag = model?.tagByPosition(position);
      if (!model || !tag) {
        deps.notice(t.organize.tags.noSlot(position));
        return;
      }
      if (itemIds.length === 0) return;
      try {
        if (itemIds.length <= TOGGLE_CHUNK) {
          const done = await deps.tags.togglePosition({ position, itemIds: [...itemIds] });
          if (done === null) {
            deps.notice(t.organize.tags.noSlot(position));
            return;
          }
          deps.patch((snap) => withTagged(snap, done.tagId, itemIds, done.assigned));
        } else {
          // Past what one call takes: the model says whether every item has the tag, and the calls go in pieces.
          const held = model.tagItems(tag.id);
          const assigned = !itemIds.every((id) => held.has(id));
          for (let from = 0; from < itemIds.length; from += TOGGLE_CHUNK) {
            const piece = itemIds.slice(from, from + TOGGLE_CHUNK);
            await (assigned ? deps.tags.assign({ tagId: tag.id, itemIds: piece }) : deps.tags.unassign({ tagId: tag.id, itemIds: piece }));
          }
          deps.patch((snap) => withTagged(snap, tag.id, itemIds, assigned));
        }
      } catch (e) {
        deps.failed(e);
      }
    },
  };
}
