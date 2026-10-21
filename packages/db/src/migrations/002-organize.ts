export const sql = `
ALTER TABLE collections ADD COLUMN updated_at TEXT;
ALTER TABLE collections ADD COLUMN deleted_at TEXT;
ALTER TABLE collection_items ADD COLUMN added_at TEXT;
CREATE INDEX collections_parent ON collections(parent_id);
CREATE INDEX collection_items_item ON collection_items(item_id);
ALTER TABLE tags ADD COLUMN color TEXT;
ALTER TABLE tags ADD COLUMN position INTEGER CHECK (position IS NULL OR position BETWEEN 1 AND 8);
ALTER TABLE tags ADD COLUMN created_at TEXT;
CREATE UNIQUE INDEX tags_position ON tags(position) WHERE position IS NOT NULL;
-- v1's UNIQUE(name) was case-sensitive. Merge names that differ only by case into the oldest tag (MIN(rowid),
-- same NOCASE folding as the index below): move the assignments over, then drop the others.
INSERT OR IGNORE INTO item_tags (item_id, tag_id)
  SELECT it.item_id, (SELECT k.id FROM tags k WHERE k.name = t.name COLLATE NOCASE ORDER BY k.rowid LIMIT 1)
  FROM item_tags it JOIN tags t ON t.id = it.tag_id;
DELETE FROM item_tags WHERE tag_id IN (SELECT id FROM tags WHERE rowid NOT IN (SELECT MIN(rowid) FROM tags GROUP BY name COLLATE NOCASE));
DELETE FROM tags WHERE rowid NOT IN (SELECT MIN(rowid) FROM tags GROUP BY name COLLATE NOCASE);
CREATE UNIQUE INDEX tags_name_nocase ON tags(name COLLATE NOCASE);
CREATE INDEX item_tags_tag ON item_tags(tag_id);
CREATE INDEX items_deleted_at ON items(deleted_at);
CREATE INDEX anchors_revision ON anchors(revision_id);
CREATE INDEX annotations_anchor ON annotations(anchor_id);
CREATE INDEX jobs_state ON jobs(state);
CREATE INDEX source_revisions_parent ON source_revisions(parent_revision_id);
CREATE TABLE reading_positions (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE CASCADE,
  locator_json TEXT NOT NULL,
  progress REAL CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),
  opened_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX reading_positions_revision ON reading_positions(revision_id);
`;
