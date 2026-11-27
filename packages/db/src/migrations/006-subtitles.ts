/**
 * Adds the subtitle tables only, so it runs with foreign keys on. A track is keyed to the item's `subtitle` link
 * through the composite foreign key: deleting the link (or the item) takes the track with it. A `subtitle` link from
 * before v6 gets no track here (001 allowed the role, nothing wrote it): it is left as it is and counts as no subtitle.
 */
export const sql = `
CREATE TABLE subtitle_tracks (
  item_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'subtitle' CHECK (role = 'subtitle'),
  language TEXT CHECK (language IS NULL OR length(language) BETWEEN 2 AND 35),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, asset_id),
  FOREIGN KEY (item_id, asset_id, role) REFERENCES item_assets(item_id, asset_id, role) ON DELETE CASCADE
);
CREATE INDEX subtitle_tracks_asset ON subtitle_tracks(asset_id);

CREATE TABLE cue_texts (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  cue_index INTEGER NOT NULL CHECK (cue_index >= 0),
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
  text TEXT NOT NULL,
  UNIQUE (sha256, cue_index)
);
CREATE INDEX cue_texts_time ON cue_texts(sha256, start_ms);
CREATE VIRTUAL TABLE cue_texts_fts USING fts5(
  text, content = 'cue_texts', content_rowid = 'id', tokenize = 'trigram remove_diacritics 2'
);
CREATE TRIGGER cue_texts_ai AFTER INSERT ON cue_texts BEGIN
  INSERT INTO cue_texts_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER cue_texts_ad AFTER DELETE ON cue_texts BEGIN
  INSERT INTO cue_texts_fts(cue_texts_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER cue_texts_au AFTER UPDATE ON cue_texts BEGIN
  INSERT INTO cue_texts_fts(cue_texts_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO cue_texts_fts(rowid, text) VALUES (new.id, new.text);
END;
`;
