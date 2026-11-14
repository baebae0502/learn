import { z } from 'zod';
import { agentIdSchema, type AgentId } from './agents';
import { pdfPageAnchor, pdfSpanAnchor, type PdfPageAnchor } from './anchors';
import type { ErrorCode } from './errors';

export const TUTOR_TOOLS = ['get_context', 'get_outline', 'read_pdf_pages'] as const;
export type TutorTool = (typeof TUTOR_TOOLS)[number];
export const TOOL_OUTCOMES = ['ok', 'limited', 'duplicate', 'refused', 'failed', 'pending'] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];
export type MessageStatus = 'streaming' | 'complete' | 'failed' | 'stopped';
export const STOP_REASONS = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled', 'too_long', 'interrupted'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const TUTOR_LIMITS = {
  pagesPerCall: 5, charsPerCall: 24_000, charsPerPage: 12_000, pagesPerTurn: 40, outlineEntries: 300, outlineTitle: 300, outlineDepth: 8,
  selectionChars: 4_000, questionChars: 8_000, replayChars: 16_000, answerChars: 100_000, saveEveryMs: 2_000, saveEveryChars: 2_000,
  textBatchMs: 33, pendingWaitMs: 10_000, sessionTitle: 200,
  idleCloseMs: 300_000, // a Claude process group holds 315–433 MB, so five minutes, not ten
} as const;

export const TUTOR_TIMEOUTS = {
  initializeMs: 20_000, sessionMs: 30_000, firstUpdateMs: 90_000, betweenMs: 180_000, turnMs: 900_000,
  cancelGraceMs: 3_000, // a cancel took 91 ms on the dev server
  termGraceMs: 2_000, probeMs: 20_000, quitMs: 2_000, versionMs: 5_000, loginShellMs: 3_000,
  authStatusMs: 3_000, // how long after initialize the auth status notification is waited for
} as const;

export const CONSENT_VERSION = 1;
export const tutorPrefsSchema = z.object({
  consent: z.object({ version: z.literal(CONSENT_VERSION), at: z.string().min(1).max(64) }).strict().nullable(),
  agent: agentIdSchema.nullable(),
}).strict();
export type TutorPrefs = z.infer<typeof tutorPrefsSchema>;
export const DEFAULT_TUTOR_PREFS: TutorPrefs = { consent: null, agent: null };

export const sentScopeSchema = z.object({ selection: z.union([z.literal(0), z.literal(1)]), replayedTurns: z.number().int().min(0), preamble: z.boolean() }).strict();
export type SentScope = z.infer<typeof sentScopeSchema>;

export interface SourceChip { pageIndex: number | null; label: string; anchorId: string | null; revisionId: string | null; quote: string | null }
export interface ToolChip { tool: TutorTool; outcome: ToolOutcome; pageFrom: number | null; pageTo: number | null; withSelection: boolean }
export interface MessageView {
  id: string; seq: number; role: 'user' | 'tutor'; kind: 'question' | 'reground' | 'answer'; text: string; status: MessageStatus;
  stopReason: StopReason | null; errorCode: ErrorCode | null; agent: AgentId | null; createdAt: string;
  attached: SourceChip | null; sources: SourceChip[]; tools: ToolChip[]; sent: SentScope | null;
}
export interface SessionSummary { id: string; itemId: string; title: string; renamed: boolean; agent: AgentId; mixedAgents: boolean; createdAt: string; updatedAt: string }
export interface SessionThread { session: SessionSummary; item: { id: string; title: string }; messages: MessageView[] }
export interface RecentSessions { groups: Array<{ item: { id: string; title: string }; sessions: SessionSummary[] }> }
export type TutorTurnEvent = { conversationId: string; messageId: string } & (
  | { kind: 'text'; append: string }
  | { kind: 'tool'; chip: ToolChip; running: boolean }
  | { kind: 'done'; status: 'complete' | 'stopped'; stopReason: StopReason | null; sources: SourceChip[] }
  | { kind: 'failed'; phase: 'before' | 'during'; code: ErrorCode });
/** tutor:ask's answer: the rows it wrote, or the other session's answer this question waits for (no row written). */
export type TutorAskAnswer = { conversationId: string; userMessageId: string; tutorMessageId: string } | { busyWith: { conversationId: string; messageId: string } };
export interface SessionsChanged { reason: 'created' | 'updated' | 'renamed' | 'deleted' | 'restored'; itemIds: string[]; conversationIds: string[] }

/** What a tool returns (sent, so strict): read_pdf_pages' pages, get_context's context or get_outline's outline. */
export type TutorEnvelope = {
  tool: TutorTool;
  item: { id: string; title: string };
  pages?: Array<{ anchor: PdfPageAnchor; label: string; cite: string; text: string | null; duplicate: boolean; truncated: boolean }>;
  context?: { pageCount: number; readerPage: number; selection: { page: number; text: string } | null; materials: 1 };
  outline?: Array<{ title: string; depth: number; page: number | null; cite: string | null }>;
  returned: number;
  total: number;
  limited: boolean;
  next: { from: number } | null;
  provenance: { revisionId: string; sha256: string; parser: 'pdf-text-1' };
};
export const tutorEnvelope: z.ZodType<TutorEnvelope> = z.object({
  tool: z.enum(TUTOR_TOOLS),
  item: z.object({ id: z.string(), title: z.string() }).strict(),
  pages: z.array(z.object({
    anchor: pdfPageAnchor, label: z.string(), cite: z.string(), text: z.string().nullable(), duplicate: z.boolean(), truncated: z.boolean(),
  }).strict()).optional(),
  context: z.object({
    pageCount: z.number().int(), readerPage: z.number().int(),
    selection: z.object({ page: z.number().int(), text: z.string() }).strict().nullable(),
    materials: z.literal(1),
  }).strict().optional(),
  outline: z.array(z.object({ title: z.string(), depth: z.number().int(), page: z.number().int().nullable(), cite: z.string().nullable() }).strict()).optional(),
  returned: z.number().int(),
  total: z.number().int(),
  limited: z.boolean(),
  next: z.object({ from: z.number().int() }).strict().nullable(),
  provenance: z.object({ revisionId: z.string(), sha256: z.string(), parser: z.literal('pdf-text-1') }).strict(),
}).strict().refine(
  (e) => {
    const given = (['pages', 'context', 'outline'] as const).filter((k) => e[k] !== undefined);
    const want = e.tool === 'read_pdf_pages' ? 'pages' : e.tool === 'get_context' ? 'context' : 'outline';
    return given.length === 1 && given[0] === want;
  },
  { message: 'an envelope holds exactly the part its tool returns' },
);

const nfc = (min: number, max: number) => z.string().normalize('NFC').min(min).max(max);

/** The reader's own numbers, which main cannot get because it never opens the PDF. */
export const readerSnapshotSchema = z.object({
  pageIndex: z.number().int().min(0),
  pageCount: z.number().int().min(1).max(100_000),
  outline: z.array(z.object({
    title: z.string().max(TUTOR_LIMITS.outlineTitle), depth: z.number().int().min(0).max(TUTOR_LIMITS.outlineDepth), pageIndex: z.number().int().min(0).nullable(),
  }).strict()).max(TUTOR_LIMITS.outlineEntries),
  outlineComplete: z.boolean(),
  outlineTotal: z.number().int().min(0),
}).strict();
export type ReaderSnapshot = z.input<typeof readerSnapshotSchema>;

export const tutorConsentInput = z.object({ grant: z.literal(true) }).strict();
export const tutorAgentsInput = z.object({ mode: z.enum(['cached', 'recheck', 'research']), agent: agentIdSchema.optional() }).strict()
  .refine((v) => v.mode !== 'recheck' || v.agent !== undefined, { message: 'recheck names its agent', path: ['agent'] });
export const tutorChooseAgentInput = z.object({ agent: agentIdSchema }).strict();
export const tutorViewInput = z.object({ view: z.object({ itemId: z.uuid(), conversationId: z.uuid().nullable() }).strict().nullable() }).strict();
export const tutorWarmInput = z.object({ itemId: z.uuid(), conversationId: z.uuid().nullable() }).strict();
export const tutorAskInput = z.object({
  itemId: z.uuid(),
  conversationId: z.uuid().nullable(),
  text: nfc(1, TUTOR_LIMITS.questionChars),
  selection: z.object({ anchor: pdfSpanAnchor, text: nfc(1, TUTOR_LIMITS.selectionChars) }).strict().nullable(),
  reader: readerSnapshotSchema,
}).strict();
export const tutorStopInput = z.object({ messageId: z.uuid() }).strict();
/** Resend and reground: the failed or doubted answer, and the reader as it is now. */
export const tutorRetryInput = z.object({ messageId: z.uuid(), reader: readerSnapshotSchema }).strict();
export const sessionsListInput = z.object({ itemId: z.uuid() }).strict();
/** sessions:get, delete and restore. */
export const sessionIdInput = z.object({ conversationId: z.uuid() }).strict();
export const sessionsRenameInput = z.object({
  conversationId: z.uuid(),
  title: z.string().normalize('NFC').trim().min(1).max(TUTOR_LIMITS.sessionTitle).nullable(),
}).strict();

export type TutorConsentInput = z.input<typeof tutorConsentInput>;
export type TutorAgentsInput = z.input<typeof tutorAgentsInput>;
export type TutorChooseAgentInput = z.input<typeof tutorChooseAgentInput>;
export type TutorViewInput = z.input<typeof tutorViewInput>;
export type TutorWarmInput = z.input<typeof tutorWarmInput>;
export type TutorAskInput = z.input<typeof tutorAskInput>;
export type TutorStopInput = z.input<typeof tutorStopInput>;
export type TutorRetryInput = z.input<typeof tutorRetryInput>;
export type SessionsListInput = z.input<typeof sessionsListInput>;
export type SessionIdInput = z.input<typeof sessionIdInput>;
export type SessionsRenameInput = z.input<typeof sessionsRenameInput>;
