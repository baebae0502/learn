/**
 * Rebuilds `items` and `anchors` because SQLite cannot change a CHECK. Runs with foreign keys off (the runner's
 * foreignKeysOff path). Order is the rule: create the new table, copy, DROP the old one, then rename the new one.
 * Renaming the old table first makes SQLite 3.26+ rewrite the children's REFERENCES to the old name even with foreign
 * keys off, leaving them pointing at a dropped table.
 */
export const sql = `
-- 1. items: 'image' in the type CHECK. rowid is kept because sorts break ties on i.rowid.
CREATE TABLE items_v4 (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('pdf','video','epub','slides','web','image')),
  title TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
INSERT INTO items_v4 (rowid, id, type, title, metadata_json, created_at, updated_at, deleted_at)
  SELECT rowid, id, type, title, metadata_json, created_at, updated_at, deleted_at FROM items;
DROP TABLE items;                              -- foreign keys are off, so the CASCADE children survive
ALTER TABLE items_v4 RENAME TO items;          -- the children's REFERENCES items(id) now point at the new table
CREATE INDEX items_deleted_at ON items(deleted_at);   -- the index from 002

-- 2. anchors: 'slide' becomes 'slides', 'image' is added; columns as after 003; rowid kept (listByRevision orders by it).
CREATE TABLE anchors_v4 (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','video','epub','web','slides','image')),
  locator_json TEXT NOT NULL,
  quote TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','review','orphan')),
  schema_version INTEGER NOT NULL,
  precision TEXT NOT NULL DEFAULT 'span' CHECK (precision IN ('item','span','region')),
  text_json TEXT
);
INSERT INTO anchors_v4 (rowid, id, revision_id, kind, locator_json, quote, status, schema_version, precision, text_json)
  SELECT rowid, id, revision_id,
         CASE kind WHEN 'slide' THEN 'slides' ELSE kind END,
         CASE WHEN kind = 'slide' AND json_valid(locator_json) THEN json_set(locator_json, '$.kind', 'slides') ELSE locator_json END,
         quote, status, schema_version, precision, text_json
  FROM anchors;
DROP TABLE anchors;
ALTER TABLE anchors_v4 RENAME TO anchors;      -- annotations.anchor_id (RESTRICT) now points at the new table
CREATE INDEX anchors_revision ON anchors(revision_id);  -- the index from 002

-- 3. image size
ALTER TABLE assets ADD COLUMN width INTEGER CHECK (width IS NULL OR width > 0);
ALTER TABLE assets ADD COLUMN height INTEGER CHECK (height IS NULL OR height > 0);

-- 4. page texts and their index
CREATE TABLE page_texts (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  page_index INTEGER NOT NULL CHECK (page_index >= 0),
  text TEXT NOT NULL,
  UNIQUE (sha256, page_index)
);
CREATE VIRTUAL TABLE page_texts_fts USING fts5(
  text, content = 'page_texts', content_rowid = 'id', tokenize = 'trigram remove_diacritics 2'
);
CREATE TRIGGER page_texts_ai AFTER INSERT ON page_texts BEGIN
  INSERT INTO page_texts_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER page_texts_ad AFTER DELETE ON page_texts BEGIN
  INSERT INTO page_texts_fts(page_texts_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER page_texts_au AFTER UPDATE ON page_texts BEGIN
  INSERT INTO page_texts_fts(page_texts_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO page_texts_fts(rowid, text) VALUES (new.id, new.text);
END;

-- 5. v0 extract jobs nothing consumed
DELETE FROM jobs WHERE kind = 'extract' AND dedupe_key LIKE 'extract:%:text-v0';
`;
