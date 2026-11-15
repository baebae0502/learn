/**
 * Rebuilds `anchors` because SQLite cannot change a CHECK: `precision` gains 'page' (a whole PDF page, no coordinates),
 * and only a rebuild can widen that CHECK. Runs with foreign keys off (the runner's foreignKeysOff path, as 004).
 * Order is the rule: create the new table, copy with rowid, DROP the old one, then rename the new one. Renaming the old
 * table first makes SQLite 3.26+ rewrite `annotations`' REFERENCES to the old name even with foreign keys off, leaving
 * them pointing at a dropped table. The five tutor tables follow.
 */
export const sql = `
-- 1. anchors: precision에 'page'(pdf만). 열 순서는 004 그대로, rowid를 지킨다(listByRevision ORDER BY rowid).
CREATE TABLE anchors_v5 (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','video','epub','web','slides','image')),
  locator_json TEXT NOT NULL,
  quote TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','review','orphan')),
  schema_version INTEGER NOT NULL,
  precision TEXT NOT NULL DEFAULT 'span' CHECK (precision IN ('item','span','region','page')),
  text_json TEXT,
  CHECK (precision <> 'page' OR kind = 'pdf')
);
INSERT INTO anchors_v5 (rowid, id, revision_id, kind, locator_json, quote, status, schema_version, precision, text_json)
  SELECT rowid, id, revision_id, kind, locator_json, quote, status, schema_version, precision, text_json FROM anchors;
DROP TABLE anchors;
ALTER TABLE anchors_v5 RENAME TO anchors;           -- annotations.anchor_id(RESTRICT)가 새 표를 가리킨다
CREATE INDEX anchors_revision ON anchors(revision_id);

-- 2. 대화(세션). item_id = 세션을 연 자료(J34). 이름이 없으면 첫 질문이 이름.
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200),
  agent TEXT NOT NULL CHECK (length(agent) BETWEEN 1 AND 32 AND agent NOT GLOB '*[^a-z0-9-]*'),
  agent_session_id TEXT CHECK (agent_session_id IS NULL OR length(agent_session_id) BETWEEN 1 AND 256),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX conversations_item ON conversations(item_id, updated_at);
CREATE INDEX conversations_recent ON conversations(updated_at);
CREATE INDEX conversations_parent ON conversations(parent_id);
CREATE INDEX conversations_deleted ON conversations(deleted_at) WHERE deleted_at IS NOT NULL;

-- 3. 메시지. 사용자: 질문·원문 근거 요청(늘 complete). 튜터: 답.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  role TEXT NOT NULL CHECK (role IN ('user','tutor')),
  kind TEXT NOT NULL CHECK (kind IN ('question','reground','answer')),
  text TEXT NOT NULL CHECK (length(text) <= 200000),
  status TEXT NOT NULL CHECK (status IN ('streaming','complete','failed','stopped')),
  stop_reason TEXT CHECK (stop_reason IS NULL OR length(stop_reason) BETWEEN 1 AND 32),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 64),
  agent TEXT CHECK (agent IS NULL OR (length(agent) BETWEEN 1 AND 32 AND agent NOT GLOB '*[^a-z0-9-]*')),
  agent_version TEXT CHECK (agent_version IS NULL OR length(agent_version) <= 64),
  model TEXT CHECK (model IS NULL OR length(model) <= 128),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  sent_json TEXT CHECK (sent_json IS NULL OR json_valid(sent_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (conversation_id, seq),
  CHECK ((role = 'user' AND kind IN ('question','reground') AND status = 'complete' AND agent IS NULL AND stop_reason IS NULL)
      OR (role = 'tutor' AND kind = 'answer' AND agent IS NOT NULL AND sent_json IS NULL))
);

-- 4. 인용 출처: 확인된 인용(cited, 답)과 붙인 선택(attached, 질문). 앵커가 사라져도 표기는 남는다(J35).
CREATE TABLE message_sources (
  id INTEGER PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('cited','attached')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  anchor_id TEXT REFERENCES anchors(id) ON DELETE SET NULL,
  page_index INTEGER CHECK (page_index IS NULL OR page_index >= 0),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 32),
  quote_snapshot TEXT CHECK (quote_snapshot IS NULL OR length(quote_snapshot) <= 4000),
  UNIQUE (message_id, role, ordinal),
  CHECK (role = 'attached' OR quote_snapshot IS NULL)
);
CREATE INDEX message_sources_message ON message_sources(message_id);
CREATE INDEX message_sources_anchor ON message_sources(anchor_id);
CREATE UNIQUE INDEX message_sources_cited_page ON message_sources(message_id, page_index) WHERE role = 'cited';

-- 5. 대화 맥락(ADR-0009 5절): opened_from = 세션을 연 쪽. attached는 T1b의 \`@\`.
CREATE TABLE conversation_context (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  anchor_id TEXT NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('opened_from','attached')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, anchor_id, role)
);
CREATE UNIQUE INDEX conversation_context_opened ON conversation_context(conversation_id) WHERE role = 'opened_from';
CREATE INDEX conversation_context_anchor ON conversation_context(anchor_id);

-- 6. 도구 읽기 기록(5.5). 질문·답·쪽 글은 없다.
CREATE TABLE tool_reads (
  id INTEGER PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  tool TEXT NOT NULL CHECK (length(tool) BETWEEN 1 AND 64),
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','limited','duplicate','refused','failed','pending')),
  revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  page_from INTEGER CHECK (page_from IS NULL OR page_from >= 0),
  page_to INTEGER CHECK (page_to IS NULL OR page_to >= page_from),
  duplicate_pages INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_pages >= 0),
  chars INTEGER NOT NULL DEFAULT 0 CHECK (chars >= 0),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 64),
  ms INTEGER NOT NULL CHECK (ms >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (message_id, seq),
  CHECK ((page_from IS NULL) = (page_to IS NULL))
);
CREATE INDEX tool_reads_revision ON tool_reads(revision_id);
`;
