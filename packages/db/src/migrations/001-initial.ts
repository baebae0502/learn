export const sql = `
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('pdf','video','epub','slides','web')),
  title TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  storage_mode TEXT NOT NULL CHECK (storage_mode IN ('managed','linked')),
  relative_path TEXT,
  external_path TEXT,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','missing')),
  created_at TEXT NOT NULL,
  checked_at TEXT,
  CHECK ((storage_mode = 'managed' AND relative_path IS NOT NULL AND external_path IS NULL)
      OR (storage_mode = 'linked' AND external_path IS NOT NULL AND relative_path IS NULL))
);
CREATE INDEX assets_sha256 ON assets(sha256);
CREATE UNIQUE INDEX assets_managed_sha256 ON assets(sha256) WHERE storage_mode = 'managed';

CREATE TABLE item_assets (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('original','subtitle','derived')),
  PRIMARY KEY (item_id, asset_id, role)
);
CREATE INDEX item_assets_asset ON item_assets(asset_id);

CREATE TABLE source_revisions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  hash TEXT NOT NULL,
  parent_revision_id TEXT REFERENCES source_revisions(id),
  renderer_version TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX source_revisions_asset ON source_revisions(asset_id);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, item_id)
);

CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE anchors (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','video','epub','web','slide')),
  locator_json TEXT NOT NULL,
  quote TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','review','orphan')),
  schema_version INTEGER NOT NULL
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  anchor_id TEXT NOT NULL REFERENCES anchors(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('stroke','highlight','note')),
  body_json TEXT NOT NULL,
  color TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed','interrupted','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  progress REAL,
  error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
