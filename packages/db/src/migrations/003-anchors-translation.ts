/**
 * Only adds columns to `anchors`: annotations reference it with ON DELETE RESTRICT and migrations run with foreign keys on,
 * so a table rebuild would fail. The kind list stays as it is.
 */
export const sql = `
ALTER TABLE anchors ADD COLUMN precision TEXT NOT NULL DEFAULT 'span' CHECK (precision IN ('item','span','region'));
ALTER TABLE anchors ADD COLUMN text_json TEXT;
CREATE TABLE translation_cache (
  key TEXT PRIMARY KEY, engine TEXT NOT NULL, from_lang TEXT NOT NULL, to_lang TEXT NOT NULL,
  detected_lang TEXT, result TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT NOT NULL
);
CREATE INDEX translation_cache_used ON translation_cache(used_at);
`;
