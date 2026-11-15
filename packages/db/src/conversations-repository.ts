import { z } from 'zod';
import {
  ERROR_CODES, LearnError, STOP_REASONS, TOOL_OUTCOMES, TUTOR_LIMITS, TUTOR_TOOLS, agentIdSchema, newId, pdfSpanAnchor, sentScopeSchema,
  type AgentId, type ErrorCode, type MessageStatus, type MessageView, type PdfSpanAnchor, type PurgeVariant, type RecentSessions, type SentScope,
  type SessionSummary, type SessionThread, type SourceChip, type StopReason, type ToolChip, type ToolOutcome, type TutorTool,
} from '@learn/domain';
import { AnchorsRepository, pageAnchorIn } from './anchors-repository';
import type { Db } from './connection';

const ANSWER_COLUMN_MAX = 200_000;
const LABEL = z.string().min(1).max(32);

const beginTurnSchema = z.object({
  conversationId: z.uuid().nullable(),
  itemId: z.uuid(),
  revisionId: z.uuid(),
  agent: agentIdSchema,
  openedAtPage: z.number().int().min(0),
  user: z.object({
    kind: z.enum(['question', 'reground']),
    text: z.string().min(1).max(TUTOR_LIMITS.questionChars),
    sent: sentScopeSchema,
    attached: z.object({ anchor: pdfSpanAnchor, quote: z.string().min(1).max(TUTOR_LIMITS.selectionChars), label: LABEL }).strict().nullable(),
  }).strict(),
  now: z.string().min(1).max(64),
}).strict();
export type BeginTurnInput = z.input<typeof beginTurnSchema>;

const finishTurnSchema = z.object({
  status: z.enum(['complete', 'stopped', 'failed']),
  text: z.string().max(ANSWER_COLUMN_MAX),
  stopReason: z.enum(STOP_REASONS).nullable(),
  errorCode: z.enum(ERROR_CODES).nullable(),
  revisionId: z.uuid(),
  // No count of its own: a verified page is inside the document (checkCitations), and pages read again are free of the turn's budget.
  verified: z.array(z.object({ pageIndex: z.number().int().min(0), label: LABEL }).strict())
    .refine((v) => new Set(v.map((p) => p.pageIndex)).size === v.length, { message: 'a page is cited once' }),
  agentVersion: z.string().max(64).nullable().optional(),
  model: z.string().max(128).nullable().optional(),
  inputTokens: z.number().int().min(0).nullable().optional(),
  outputTokens: z.number().int().min(0).nullable().optional(),
}).strict();
export interface FinishTurnInput {
  status: 'complete' | 'stopped' | 'failed'; text: string; stopReason: StopReason | null; errorCode: ErrorCode | null;
  revisionId: string; verified: Array<{ pageIndex: number; label: string }>;
  agentVersion?: string | null; model?: string | null; inputTokens?: number | null; outputTokens?: number | null;
}

const toolReadSchema = z.object({
  tool: z.enum(TUTOR_TOOLS),
  outcome: z.enum(TOOL_OUTCOMES),
  revisionId: z.uuid().nullable(),
  pageFrom: z.number().int().min(0).nullable(),
  pageTo: z.number().int().min(0).nullable(),
  duplicatePages: z.number().int().min(0),
  chars: z.number().int().min(0),
  errorCode: z.string().min(1).max(64).nullable(),
  ms: z.number().int().min(0),
}).strict().refine((r) => (r.pageFrom === null) === (r.pageTo === null) && (r.pageFrom === null || r.pageTo! >= r.pageFrom), { message: 'a page range has both ends, in order' });
export interface ToolReadInput { tool: TutorTool; outcome: ToolOutcome; revisionId: string | null; pageFrom: number | null; pageTo: number | null; duplicatePages: number; chars: number; errorCode: string | null; ms: number }

const titleSchema = z.string().normalize('NFC').trim().min(1).max(TUTOR_LIMITS.sessionTitle).nullable();
const idSchema = z.string().min(1).max(64);
const timeSchema = z.string().min(1).max(64);
const purgeCountSchema = z.object({
  variant: z.enum(['items', 'collections', 'mixed', 'empty']),
  itemIds: z.array(z.string()).max(1_000_000),
}).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new LearnError('VALIDATION_FAILED', '세션 요청이 올바르지 않습니다.');
  return r.data;
}

interface SummaryRow {
  id: string; item_id: string; title: string | null; agent: AgentId; created_at: string; updated_at: string; first_text: string | null; agents: number;
}
interface MessageRow {
  id: string; conversation_id: string; seq: number; role: 'user' | 'tutor'; kind: MessageView['kind']; text: string; status: MessageStatus;
  stop_reason: StopReason | null; error_code: ErrorCode | null; agent: AgentId | null; sent_json: string | null; created_at: string;
}
interface SourceRow { message_id: string; role: 'cited' | 'attached'; page_index: number | null; label: string; quote_snapshot: string | null; anchor_id: string | null; revision_id: string | null }
interface ToolRow {
  message_id: string; seq: number; tool: TutorTool; outcome: ToolOutcome; revision_id: string | null; page_from: number | null; page_to: number | null;
  duplicate_pages: number; chars: number; error_code: string | null; ms: number;
}

const SUMMARY = `
SELECT c.id, c.item_id, c.title, c.agent, c.created_at, c.updated_at,
  (SELECT m.text FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.seq LIMIT 1) AS first_text,
  (SELECT COUNT(DISTINCT m.agent) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'tutor') AS agents
FROM conversations c`;
/** A live session of an item that is not in the trash. */
const VISIBLE = `c.deleted_at IS NULL AND c.item_id IN (SELECT id FROM items WHERE deleted_at IS NULL)`;

function firstLine(text: string | null): string {
  const line = (text ?? '').split(/\r\n|\r|\n/).map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.slice(0, TUTOR_LIMITS.sessionTitle);
}

function toSummary(r: SummaryRow): SessionSummary {
  return {
    id: r.id, itemId: r.item_id, title: r.title ?? firstLine(r.first_text), renamed: r.title !== null, agent: r.agent,
    mixedAgents: r.agents > 1, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toToolChip(r: { tool: TutorTool; outcome: ToolOutcome; page_from: number | null; page_to: number | null }, withSelection: boolean): ToolChip {
  return { tool: r.tool, outcome: r.outcome, pageFrom: r.page_from, pageTo: r.page_to, withSelection };
}

/** A span anchor a passage made is kept while a message, a session's context or an annotation still points at it. */
const ANCHOR_IN_USE = `SELECT EXISTS (SELECT 1 FROM message_sources WHERE anchor_id = @id) OR EXISTS (SELECT 1 FROM conversation_context WHERE anchor_id = @id)
                       OR EXISTS (SELECT 1 FROM annotations WHERE anchor_id = @id)`;

/** Sessions (conversations), their messages, the pages answers cited and the passage a question carried, and every tool read (spec 6). */
export class ConversationsRepository {
  private readonly anchors: AnchorsRepository;

  constructor(private readonly db: Db) {
    this.anchors = new AnchorsRepository(db);
  }

  beginTurn(input: BeginTurnInput): BeginTurnResult {
    const i = parse(beginTurnSchema, input);
    if (i.user.attached && i.user.attached.anchor.revisionId !== i.revisionId) throw new LearnError('VALIDATION_FAILED', '붙인 선택이 이 자료의 것이 아닙니다.');
    return this.db.transaction((): BeginTurnResult => {
      let conversationId = i.conversationId;
      const created = conversationId === null;
      if (conversationId === null) {
        const ok = this.db.prepare(`SELECT EXISTS (SELECT 1 FROM items i JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
                                                 JOIN source_revisions r ON r.asset_id = ia.asset_id
                                                 WHERE i.id = ? AND i.deleted_at IS NULL AND r.id = ?)`).pluck().get(i.itemId, i.revisionId) === 1;
        if (!ok) throw new LearnError('VALIDATION_FAILED', '이 자료의 세션이 아닙니다.');
        conversationId = newId();
        this.db.prepare(`INSERT INTO conversations (id, item_id, title, agent, agent_session_id, created_at, updated_at) VALUES (?, ?, NULL, ?, NULL, ?, ?)`)
          .run(conversationId, i.itemId, i.agent, i.now, i.now);
        const page = pageAnchorIn(this.db, i.revisionId, i.openedAtPage);
        this.db.prepare(`INSERT INTO conversation_context (conversation_id, anchor_id, role, created_at) VALUES (?, ?, 'opened_from', ?)`).run(conversationId, page.id, i.now);
      } else {
        const row = this.db.prepare('SELECT item_id, deleted_at FROM conversations WHERE id = ?').get(conversationId) as { item_id: string; deleted_at: string | null } | undefined;
        if (!row || row.item_id !== i.itemId || row.deleted_at !== null) throw new LearnError('VALIDATION_FAILED', '이 자료의 세션이 아닙니다.');
      }
      const seq = (this.db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE conversation_id = ?').pluck().get(conversationId) as number);
      const userMessageId = newId();
      const tutorMessageId = newId();
      const insert = this.db.prepare(`INSERT INTO messages (id, conversation_id, seq, role, kind, text, status, agent, sent_json, created_at)
                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insert.run(userMessageId, conversationId, seq, 'user', i.user.kind, i.user.text, 'complete', null, JSON.stringify(i.user.sent), i.now);
      if (i.user.attached) {
        const { anchor, quote, label } = i.user.attached;
        const record = this.anchors.create(anchor);
        this.db.prepare(`INSERT INTO message_sources (message_id, role, ordinal, anchor_id, page_index, label, quote_snapshot) VALUES (?, 'attached', 0, ?, ?, ?, ?)`)
          .run(userMessageId, record.id, anchor.pageIndex, label, quote);
      }
      insert.run(tutorMessageId, conversationId, seq + 1, 'tutor', 'answer', '', 'streaming', i.agent, null, i.now);
      this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(i.now, conversationId);
      return { conversationId, userMessageId, tutorMessageId, created };
    })();
  }

  retryTurn(failedTutorMessageId: string, agent: AgentId, now: string): { conversationId: string; userMessageId: string; tutorMessageId: string } {
    const id = parse(idSchema, failedTutorMessageId);
    const a = parse(agentIdSchema, agent);
    const at = parse(timeSchema, now);
    return this.db.transaction(() => {
      const row = this.db.prepare(`SELECT conversation_id, seq, role, status, error_code FROM messages WHERE id = ?`).get(id) as
        { conversation_id: string; seq: number; role: string; status: MessageStatus; error_code: string | null } | undefined;
      if (!row) throw new LearnError('NOT_FOUND', '답을 찾을 수 없습니다.');
      if (row.role !== 'tutor' || row.status !== 'failed' || row.error_code === 'AGENT_LOCKDOWN') throw new LearnError('VALIDATION_FAILED', '다시 보낼 수 없는 답입니다.');
      const owner = this.db.prepare(`SELECT c.deleted_at, i.deleted_at AS item_deleted FROM conversations c JOIN items i ON i.id = c.item_id WHERE c.id = ?`)
        .get(row.conversation_id) as { deleted_at: string | null; item_deleted: string | null } | undefined;
      if (!owner || owner.deleted_at !== null || owner.item_deleted !== null) throw new LearnError('VALIDATION_FAILED', '이 자료의 세션이 아닙니다.');
      const user = this.db.prepare(`SELECT id FROM messages WHERE conversation_id = ? AND seq = ? AND role = 'user'`).pluck().get(row.conversation_id, row.seq - 1) as string | undefined;
      if (user === undefined) throw new LearnError('NOT_FOUND', '질문을 찾을 수 없습니다.');
      this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
      const tutorMessageId = newId();
      this.db.prepare(`INSERT INTO messages (id, conversation_id, seq, role, kind, text, status, agent, created_at) VALUES (?, ?, ?, 'tutor', 'answer', '', 'streaming', ?, ?)`)
        .run(tutorMessageId, row.conversation_id, row.seq, a, at);
      this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(at, row.conversation_id);
      return { conversationId: row.conversation_id, userMessageId: user, tutorMessageId };
    })();
  }

  setAgentSession(conversationId: string, agent: AgentId, agentSessionId: string | null, now: string): void {
    const a = parse(agentIdSchema, agent);
    const session = parse(z.string().min(1).max(256).nullable(), agentSessionId);
    const r = this.db.prepare('UPDATE conversations SET agent = ?, agent_session_id = ?, updated_at = ? WHERE id = ?').run(a, session, parse(timeSchema, now), parse(idSchema, conversationId));
    if (r.changes === 0) throw new LearnError('NOT_FOUND', '세션을 찾을 수 없습니다.');
  }

  setSent(userMessageId: string, sent: SentScope): void {
    const s = parse(sentScopeSchema, sent);
    const r = this.db.prepare(`UPDATE messages SET sent_json = ? WHERE id = ? AND role = 'user'`).run(JSON.stringify(s), parse(idSchema, userMessageId));
    if (r.changes === 0) throw new LearnError('NOT_FOUND', '질문을 찾을 수 없습니다.');
  }

  attachedOf(userMessageId: string): { anchor: PdfSpanAnchor; quote: string; label: string } | null {
    const row = this.db.prepare(`SELECT anchor_id, quote_snapshot, label FROM message_sources WHERE message_id = ? AND role = 'attached' AND ordinal = 0`)
      .get(parse(idSchema, userMessageId)) as { anchor_id: string | null; quote_snapshot: string | null; label: string } | undefined;
    if (!row || row.anchor_id === null || row.quote_snapshot === null) return null;
    const record = this.anchors.get(row.anchor_id);
    const parsed = record ? pdfSpanAnchor.safeParse(record.anchor) : undefined;
    return parsed?.success ? { anchor: parsed.data, quote: row.quote_snapshot, label: row.label } : null;
  }

  saveText(tutorMessageId: string, text: string, now: string): void {
    const t = parse(z.string().max(ANSWER_COLUMN_MAX), text);
    const at = parse(timeSchema, now);
    this.db.transaction(() => {
      const r = this.db.prepare(`UPDATE messages SET text = ? WHERE id = ? AND role = 'tutor' AND status = 'streaming'`).run(t, parse(idSchema, tutorMessageId));
      if (r.changes === 0) throw new LearnError('NOT_FOUND', '받는 중인 답을 찾을 수 없습니다.');
      this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = (SELECT conversation_id FROM messages WHERE id = ?)`).run(at, tutorMessageId);
    })();
  }

  finishTurn(tutorMessageId: string, finish: FinishTurnInput, now: string): SourceChip[] {
    const f = parse(finishTurnSchema, finish);
    const at = parse(timeSchema, now);
    const id = parse(idSchema, tutorMessageId);
    return this.db.transaction((): SourceChip[] => {
      const row = this.db.prepare(`SELECT conversation_id, status FROM messages WHERE id = ? AND role = 'tutor'`).get(id) as { conversation_id: string; status: MessageStatus } | undefined;
      if (!row) throw new LearnError('NOT_FOUND', '답을 찾을 수 없습니다.');
      if (row.status !== 'streaming') throw new LearnError('VALIDATION_FAILED', '이미 끝난 답입니다.');
      const insert = this.db.prepare(`INSERT INTO message_sources (message_id, role, ordinal, anchor_id, page_index, label) VALUES (?, 'cited', ?, ?, ?, ?)`);
      const chips = f.verified.map((page, ordinal): SourceChip => {
        const anchor = pageAnchorIn(this.db, f.revisionId, page.pageIndex);
        insert.run(id, ordinal, anchor.id, page.pageIndex, page.label);
        return { pageIndex: page.pageIndex, label: page.label, anchorId: anchor.id, revisionId: f.revisionId, quote: null };
      });
      this.db.prepare(`UPDATE messages SET status = ?, text = ?, stop_reason = ?, error_code = ?, completed_at = ?, agent_version = ?, model = ?, input_tokens = ?, output_tokens = ? WHERE id = ?`)
        .run(f.status, f.text, f.stopReason, f.errorCode, at, f.agentVersion ?? null, f.model ?? null, f.inputTokens ?? null, f.outputTokens ?? null, id);
      this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(at, row.conversation_id);
      return chips;
    })();
  }

  dropBeforeAnswer(userMessageId: string, tutorMessageId: string): { conversationDeleted: boolean } {
    const userId = parse(idSchema, userMessageId);
    const tutorId = parse(idSchema, tutorMessageId);
    return this.db.transaction(() => {
      const user = this.db.prepare(`SELECT conversation_id, seq FROM messages WHERE id = ? AND role = 'user'`).get(userId) as { conversation_id: string; seq: number } | undefined;
      const tutor = this.db.prepare(`SELECT conversation_id, seq, status FROM messages WHERE id = ? AND role = 'tutor'`).get(tutorId) as { conversation_id: string; seq: number; status: MessageStatus } | undefined;
      if (!user || !tutor || user.conversation_id !== tutor.conversation_id) throw new LearnError('NOT_FOUND', '지울 메시지를 찾을 수 없습니다.');
      if (tutor.status !== 'streaming' || user.seq !== tutor.seq - 1) throw new LearnError('VALIDATION_FAILED', '지울 수 없는 메시지입니다.');
      const spans = this.db.prepare(`SELECT s.anchor_id FROM message_sources s JOIN anchors a ON a.id = s.anchor_id
                                     WHERE s.message_id = ? AND s.role = 'attached' AND a.precision = 'span'`).pluck().all(userId) as string[];
      this.db.prepare('DELETE FROM messages WHERE id IN (?, ?)').run(userId, tutorId);
      this.sweepAnchors(spans);
      const left = this.db.prepare(`SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND role = 'user'`).pluck().get(user.conversation_id) as number;
      if (left > 0) return { conversationDeleted: false };
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(user.conversation_id);
      return { conversationDeleted: true };
    })();
  }

  private sweepAnchors(ids: readonly string[]): void {
    const used = this.db.prepare(ANCHOR_IN_USE).pluck();
    const del = this.db.prepare('DELETE FROM anchors WHERE id = ?');
    for (const id of ids) if (!used.get({ id })) del.run(id);
  }

  addToolRead(tutorMessageId: string, read: ToolReadInput, now: string): ToolChip {
    const r = parse(toolReadSchema, read);
    const at = parse(timeSchema, now);
    const id = parse(idSchema, tutorMessageId);
    return this.db.transaction((): ToolChip => {
      const row = this.db.prepare(`SELECT conversation_id, seq FROM messages WHERE id = ? AND role = 'tutor'`).get(id) as { conversation_id: string; seq: number } | undefined;
      if (!row) throw new LearnError('NOT_FOUND', '답을 찾을 수 없습니다.');
      const seq = this.db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 FROM tool_reads WHERE message_id = ?').pluck().get(id) as number;
      this.db.prepare(`INSERT INTO tool_reads (message_id, seq, tool, outcome, revision_id, page_from, page_to, duplicate_pages, chars, error_code, ms, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, seq, r.tool, r.outcome, r.revisionId, r.pageFrom, r.pageTo, r.duplicatePages, r.chars, r.errorCode, r.ms, at);
      const withSelection = this.db.prepare(`SELECT EXISTS (SELECT 1 FROM messages u JOIN message_sources s ON s.message_id = u.id AND s.role = 'attached'
                                                           WHERE u.conversation_id = ? AND u.seq = ? AND u.role = 'user')`).pluck().get(row.conversation_id, row.seq - 1) === 1;
      return toToolChip({ tool: r.tool, outcome: r.outcome, page_from: r.pageFrom, page_to: r.pageTo }, withSelection);
    })();
  }

  toolReads(tutorMessageId: string): Array<ToolReadInput & { seq: number }> {
    return (this.db.prepare(`SELECT message_id, seq, tool, outcome, revision_id, page_from, page_to, duplicate_pages, chars, error_code, ms FROM tool_reads WHERE message_id = ? ORDER BY seq`)
      .all(parse(idSchema, tutorMessageId)) as ToolRow[]).map((r) => ({
      seq: r.seq, tool: r.tool, outcome: r.outcome, revisionId: r.revision_id, pageFrom: r.page_from, pageTo: r.page_to,
      duplicatePages: r.duplicate_pages, chars: r.chars, errorCode: r.error_code, ms: r.ms,
    }));
  }

  replayTurns(conversationId: string, beforeSeq: number): Array<{ question: string; answer: string }> {
    return this.db.prepare(`SELECT u.text AS question, t.text AS answer FROM messages u
                            JOIN messages t ON t.conversation_id = u.conversation_id AND t.seq = u.seq + 1 AND t.role = 'tutor' AND t.status IN ('complete', 'stopped')
                            WHERE u.conversation_id = ? AND u.role = 'user' AND t.seq < ? ORDER BY u.seq`)
      .all(parse(idSchema, conversationId), parse(z.number().int(), beforeSeq)) as Array<{ question: string; answer: string }>;
  }

  conversation(conversationId: string): { id: string; itemId: string; agent: AgentId; agentSessionId: string | null; deleted: boolean; itemTrashed: boolean } | undefined {
    const r = this.db.prepare(`SELECT c.id, c.item_id, c.agent, c.agent_session_id, c.deleted_at, i.deleted_at AS item_deleted FROM conversations c JOIN items i ON i.id = c.item_id WHERE c.id = ?`)
      .get(parse(idSchema, conversationId)) as { id: string; item_id: string; agent: AgentId; agent_session_id: string | null; deleted_at: string | null; item_deleted: string | null } | undefined;
    return r && { id: r.id, itemId: r.item_id, agent: r.agent, agentSessionId: r.agent_session_id, deleted: r.deleted_at !== null, itemTrashed: r.item_deleted !== null };
  }

  message(messageId: string): { id: string; conversationId: string; seq: number; role: 'user' | 'tutor'; kind: MessageView['kind']; status: MessageStatus; errorCode: string | null; text: string } | undefined {
    const r = this.db.prepare('SELECT id, conversation_id, seq, role, kind, status, error_code, text FROM messages WHERE id = ?').get(parse(idSchema, messageId)) as
      { id: string; conversation_id: string; seq: number; role: 'user' | 'tutor'; kind: MessageView['kind']; status: MessageStatus; error_code: string | null; text: string } | undefined;
    return r && { id: r.id, conversationId: r.conversation_id, seq: r.seq, role: r.role, kind: r.kind, status: r.status, errorCode: r.error_code, text: r.text };
  }

  list(itemId: string): SessionSummary[] {
    return (this.db.prepare(`${SUMMARY} WHERE c.item_id = ? AND ${VISIBLE} ORDER BY c.updated_at DESC, c.rowid DESC`).all(parse(idSchema, itemId)) as SummaryRow[]).map(toSummary);
  }

  recent(items = 5, perItem = 3): RecentSessions {
    const itemRows = this.db.prepare(`SELECT i.id, i.title FROM items i JOIN
        (SELECT c.item_id, MAX(c.updated_at) AS last FROM conversations c WHERE ${VISIBLE} GROUP BY c.item_id) l ON l.item_id = i.id
      ORDER BY l.last DESC, i.rowid DESC LIMIT ?`).all(items) as Array<{ id: string; title: string }>;
    const sessions = this.db.prepare(`${SUMMARY} WHERE c.item_id = ? AND c.deleted_at IS NULL ORDER BY c.updated_at DESC, c.rowid DESC LIMIT ?`);
    return { groups: itemRows.map((item) => ({ item, sessions: (sessions.all(item.id, perItem) as SummaryRow[]).map(toSummary) })) };
  }

  thread(conversationId: string): SessionThread {
    const id = parse(idSchema, conversationId);
    const summary = this.db.prepare(`${SUMMARY} WHERE c.id = ? AND ${VISIBLE}`).get(id) as SummaryRow | undefined;
    if (!summary) throw new LearnError('NOT_FOUND', '세션을 찾을 수 없습니다.');
    const item = this.db.prepare('SELECT id, title FROM items WHERE id = ?').get(summary.item_id) as { id: string; title: string };
    const rows = this.db.prepare(`SELECT id, conversation_id, seq, role, kind, text, status, stop_reason, error_code, agent, sent_json, created_at FROM messages WHERE conversation_id = ? ORDER BY seq`).all(id) as MessageRow[];
    const sources = new Map<string, SourceRow[]>();
    for (const s of this.db.prepare(`SELECT s.message_id, s.role, s.page_index, s.label, s.quote_snapshot, s.anchor_id, a.revision_id
                                     FROM message_sources s JOIN messages m ON m.id = s.message_id LEFT JOIN anchors a ON a.id = s.anchor_id
                                     WHERE m.conversation_id = ? ORDER BY s.message_id, s.role, s.ordinal`).all(id) as SourceRow[]) {
      const list = sources.get(s.message_id);
      if (list) list.push(s);
      else sources.set(s.message_id, [s]);
    }
    const tools = new Map<string, ToolRow[]>();
    for (const t of this.db.prepare(`SELECT t.message_id, t.seq, t.tool, t.outcome, t.revision_id, t.page_from, t.page_to, t.duplicate_pages, t.chars, t.error_code, t.ms
                                     FROM tool_reads t JOIN messages m ON m.id = t.message_id WHERE m.conversation_id = ? ORDER BY t.message_id, t.seq`).all(id) as ToolRow[]) {
      const list = tools.get(t.message_id);
      if (list) list.push(t);
      else tools.set(t.message_id, [t]);
    }
    const chip = (s: SourceRow): SourceChip => ({ pageIndex: s.page_index, label: s.label, anchorId: s.anchor_id, revisionId: s.revision_id, quote: s.quote_snapshot });
    const attachedBySeq = new Map(rows.map((m) => [m.seq, (sources.get(m.id) ?? []).some((s) => s.role === 'attached')] as const));
    const messages = rows.map((m): MessageView => {
      const own = sources.get(m.id) ?? [];
      const attached = own.find((s) => s.role === 'attached');
      return {
        id: m.id, seq: m.seq, role: m.role, kind: m.kind, text: m.text, status: m.status, stopReason: m.stop_reason, errorCode: m.error_code, agent: m.agent, createdAt: m.created_at,
        attached: attached ? chip(attached) : null,
        sources: own.filter((s) => s.role === 'cited').map(chip),
        tools: (tools.get(m.id) ?? []).map((t) => toToolChip(t, attachedBySeq.get(m.seq - 1) === true)),
        sent: m.sent_json === null ? null : (JSON.parse(m.sent_json) as SentScope),
      };
    });
    return { session: toSummary(summary), item, messages };
  }

  /** The name alone: a rename is no talk, so the session keeps its last turn's time and its place in the lists. */
  rename(conversationId: string, title: string | null): SessionSummary {
    const t = parse(titleSchema, title);
    const id = parse(idSchema, conversationId);
    return this.db.transaction(() => {
      const r = this.db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND deleted_at IS NULL').run(t, id);
      if (r.changes === 0) throw new LearnError('NOT_FOUND', '세션을 찾을 수 없습니다.');
      return toSummary(this.db.prepare(`${SUMMARY} WHERE c.id = ?`).get(id) as SummaryRow);
    })();
  }

  remove(conversationId: string, now: string): void {
    const r = this.db.prepare('UPDATE conversations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(parse(timeSchema, now), parse(idSchema, conversationId));
    if (r.changes === 0) throw new LearnError('NOT_FOUND', '세션을 찾을 수 없습니다.');
  }

  restore(conversationId: string): void {
    const r = this.db.prepare('UPDATE conversations SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(parse(idSchema, conversationId));
    if (r.changes === 0) throw new LearnError('NOT_FOUND', '세션을 찾을 수 없습니다.');
  }

  repairAtStartup(now: string, runStartedAt: string): { interrupted: number; purged: string[] } {
    const at = parse(timeSchema, now);
    const started = parse(timeSchema, runStartedAt);
    return this.db.transaction(() => {
      const interrupted = this.db.prepare(`UPDATE messages SET status = 'failed', stop_reason = 'interrupted', error_code = NULL, completed_at = ? WHERE status = 'streaming'`).run(at).changes;
      const purged = this.db.prepare('SELECT id FROM conversations WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY rowid').pluck().all(started) as string[];
      const spans = this.db.prepare(`SELECT s.anchor_id FROM message_sources s JOIN anchors a ON a.id = s.anchor_id JOIN messages m ON m.id = s.message_id
                                     WHERE m.conversation_id = ? AND a.precision = 'span'
                                     UNION SELECT c.anchor_id FROM conversation_context c JOIN anchors a ON a.id = c.anchor_id WHERE c.conversation_id = ? AND a.precision = 'span'`).pluck();
      const del = this.db.prepare('DELETE FROM conversations WHERE id = ?');
      const swept: string[] = [];
      for (const id of purged) { swept.push(...(spans.all(id, id) as string[])); del.run(id); }
      this.sweepAnchors(swept);
      return { interrupted, purged };
    })();
  }

  purgeCount(input: { variant: PurgeVariant; itemIds: readonly string[] }): { sessions: number; items: number } {
    const i = parse(purgeCountSchema, input);
    if (i.variant === 'collections') return { sessions: 0, items: 0 };
    const items = i.variant === 'empty' ? `SELECT id FROM items WHERE deleted_at IS NOT NULL` : `SELECT value FROM json_each(?)`;
    const stmt = this.db.prepare(`SELECT COUNT(*) AS sessions, COUNT(DISTINCT item_id) AS items FROM conversations WHERE deleted_at IS NULL AND item_id IN (${items})`);
    return (i.variant === 'empty' ? stmt.get() : stmt.get(JSON.stringify(i.itemIds))) as { sessions: number; items: number };
  }
}

export interface BeginTurnResult { conversationId: string; userMessageId: string; tutorMessageId: string; created: boolean }
