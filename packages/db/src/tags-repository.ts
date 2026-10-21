import { LearnError, TAG_COLORS, newId, nowIso, type Tag, type TagColorId } from '@learn/domain';
import type { Db } from './connection';

interface TagDbRow { id: string; name: string; color: string | null; position: number | null; item_count: number }

const COLOR_IDS: ReadonlySet<string> = new Set(TAG_COLORS.map((c) => c.id));
const isTagColor = (c: string | null): c is TagColorId => c !== null && COLOR_IDS.has(c);

/** Every tag column the `Tag` type needs; `item_count` ignores trashed items. Callers add WHERE/ORDER. */
export const TAG_SELECT = `
SELECT t.id, t.name, t.color, t.position,
       (SELECT COUNT(*) FROM item_tags it JOIN items i ON i.id = it.item_id
         WHERE it.tag_id = t.id AND i.deleted_at IS NULL) AS item_count
FROM tags t`;
/** Colored (positioned) tags first by position, then the rest in creation order. */
export const TAG_ORDER = 'ORDER BY t.position IS NULL, t.position, t.rowid';

export const toTag = (r: TagDbRow): Tag => ({
  id: r.id, name: r.name, color: isTagColor(r.color) ? r.color : null, position: r.position, itemCount: r.item_count,
});

const notFound = () => new LearnError('NOT_FOUND', '태그를 찾을 수 없습니다.');

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length < 1 || name.length > 200) throw new LearnError('VALIDATION_FAILED', '태그 이름은 1–200자여야 합니다.');
  return name;
}
function checkPosition(position: unknown): asserts position is number {
  if (!Number.isInteger(position) || (position as number) < 1 || (position as number) > 8) {
    throw new LearnError('VALIDATION_FAILED', '태그 위치는 1–8 사이의 정수여야 합니다.');
  }
}

/** Tags (names unique case-insensitively), optional color + keyboard position 1–8, and item assignments. */
export class TagsRepository {
  constructor(private readonly db: Db) {}

  list(): Tag[] {
    return (this.db.prepare(`${TAG_SELECT} ${TAG_ORDER}`).all() as TagDbRow[]).map(toTag);
  }

  get(id: string): Tag | undefined {
    const row = this.db.prepare(`${TAG_SELECT} WHERE t.id = ?`).get(id) as TagDbRow | undefined;
    return row && toTag(row);
  }

  /** Tags assigned to the item. */
  tagsOf(itemId: string): Tag[] {
    return (this.db
      .prepare(`${TAG_SELECT} WHERE t.id IN (SELECT tag_id FROM item_tags WHERE item_id = ?) ${TAG_ORDER}`)
      .all(itemId) as TagDbRow[]).map(toTag);
  }

  /** Returns the existing tag when one with the same name (ignoring case) exists. */
  create(rawName: string): Tag {
    return this.findOrCreate(rawName).tag;
  }

  /** `create`, also saying whether a new tag was made (false when an existing one was returned). */
  findOrCreate(rawName: string): { tag: Tag; created: boolean } {
    const name = cleanName(rawName);
    return this.db.transaction(() => {
      const existing = this.findByName(name);
      if (existing) return { tag: this.get(existing)!, created: false };
      const id = newId();
      this.db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)').run(id, name, nowIso());
      return { tag: this.get(id)!, created: true };
    })();
  }

  /**
   * Renames the tag. If another tag already has that name (ignoring case), the two are merged instead:
   * the assignments move to the other tag (no duplicates), this tag is deleted, and the other tag
   * (with its own name, color and position) is returned.
   */
  rename(id: string, rawName: string): Tag {
    const name = cleanName(rawName);
    return this.db.transaction(() => {
      if (!this.get(id)) throw notFound();
      const other = this.findByName(name, id);
      if (!other) {
        this.db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id);
        return this.get(id)!;
      }
      this.db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, ? FROM item_tags WHERE tag_id = ?').run(other, id);
      this.db.prepare('DELETE FROM tags WHERE id = ?').run(id); // cascades its item_tags
      return this.get(other)!;
    })();
  }

  /** Sets color and position; a position held by another tag is taken from it (that tag keeps its color). */
  setColor(id: string, color: TagColorId | null, position: number | null): Tag {
    if (color !== null && !isTagColor(color)) throw new LearnError('VALIDATION_FAILED', '지원하지 않는 태그 색입니다.');
    if (position !== null) checkPosition(position);
    return this.db.transaction(() => {
      if (!this.get(id)) throw notFound();
      if (position !== null) this.db.prepare('UPDATE tags SET position = NULL WHERE position = ? AND id <> ?').run(position, id);
      this.db.prepare('UPDATE tags SET color = ?, position = ? WHERE id = ?').run(color, position, id);
      return this.get(id)!;
    })();
  }

  remove(id: string): void {
    if (this.db.prepare('DELETE FROM tags WHERE id = ?').run(id).changes === 0) throw notFound();
  }

  /** Tags non-trashed items (duplicates and unknown ids are skipped). Returns how many assignments were created. */
  assign(tagId: string, itemIds: readonly string[]): number {
    return this.assignChanged(tagId, itemIds).length;
  }

  /** `assign`, returning the ids of the items that got the tag (each once, in input order). */
  assignChanged(tagId: string, itemIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      if (!this.get(tagId)) throw notFound();
      return this.assignAll(tagId, itemIds);
    })();
  }

  /** Returns how many assignments were removed. */
  unassign(tagId: string, itemIds: readonly string[]): number {
    return this.unassignChanged(tagId, itemIds).length;
  }

  /** `unassign`, returning the ids of the items that lost the tag (each once, in input order). */
  unassignChanged(tagId: string, itemIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      if (!this.get(tagId)) throw notFound();
      return this.unassignAll(tagId, itemIds);
    })();
  }

  /**
   * Keyboard toggle of the tag at `position` (1–8): if every target item already has it, it is removed from all;
   * otherwise it is added to all. Unknown/trashed ids are not targets; duplicates count once.
   * `null` (nothing changed) when no tag holds that position or no target remains.
   */
  togglePosition(position: number, itemIds: readonly string[]): { tagId: string; assigned: boolean } | null {
    const toggled = this.togglePositionChanged(position, itemIds);
    return toggled && { tagId: toggled.tagId, assigned: toggled.assigned };
  }

  /** `togglePosition`, also returning the items whose tags changed (when adding: only those that lacked the tag). */
  togglePositionChanged(position: number, itemIds: readonly string[]): { tagId: string; assigned: boolean; itemIds: string[] } | null {
    checkPosition(position);
    return this.db.transaction(() => {
      const tag = this.db.prepare('SELECT id FROM tags WHERE position = ?').get(position) as { id: string } | undefined;
      if (!tag) return null;
      const live = this.db.prepare('SELECT 1 FROM items WHERE id = ? AND deleted_at IS NULL');
      const has = this.db.prepare('SELECT 1 FROM item_tags WHERE item_id = ? AND tag_id = ?');
      const targets = [...new Set(itemIds)].filter((itemId) => live.get(itemId) !== undefined);
      if (targets.length === 0) return null;
      const allHave = targets.every((itemId) => has.get(itemId, tag.id) !== undefined);
      const changed = allHave ? this.unassignAll(tag.id, targets) : this.assignAll(tag.id, targets);
      return { tagId: tag.id, assigned: !allHave, itemIds: changed };
    })();
  }

  private findByName(name: string, exceptId?: string): string | undefined {
    const row = this.db
      .prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
      .get(name, exceptId ?? null) as { id: string } | undefined;
    return row?.id;
  }

  private assignAll(tagId: string, itemIds: readonly string[]): string[] {
    const ins = this.db.prepare(`INSERT OR IGNORE INTO item_tags (item_id, tag_id)
                                 SELECT i.id, ? FROM items i WHERE i.id = ? AND i.deleted_at IS NULL`);
    return itemIds.filter((itemId) => ins.run(tagId, itemId).changes > 0);
  }

  private unassignAll(tagId: string, itemIds: readonly string[]): string[] {
    const del = this.db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?');
    return itemIds.filter((itemId) => del.run(itemId, tagId).changes > 0);
  }
}
