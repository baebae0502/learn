import type { TextRepository, ToolReadInput } from '@learn/db';
import {
  LearnError, PDF_TEXT_EXTRACTOR, TUTOR_LIMITS, TUTOR_TOOLS, citeToken, type BodyTextFailure, type ToolChip, type ToolOutcome, type TutorEnvelope, type TutorTool,
} from '@learn/domain';
import { z } from 'zod';
import { mainStrings } from '../strings';
import { wrapMaterial } from './boundary';
import { guardPromptSelection, guardToolArgs, type AcpScope, type ActiveTurn } from './scope';

const page = z.number().int().min(1).max(100_000);
const item = z.uuid().optional();

/** The arguments as Learn reads them: the fields it uses, checked; any other field dropped, not refused. */
export const TOOL_INPUTS = {
  get_context: z.object({}),
  get_outline: z.object({ item }),
  read_pdf_pages: z.object({ item, from: page, to: page.optional() })
    .refine((a) => a.to === undefined || a.to >= a.from, { message: 'to comes after from', path: ['to'] }),
} satisfies Record<TutorTool, z.ZodObject>;
/** The same shapes strict, for the inputSchema the agent is told. */
export const toolInputSchemas = {
  get_context: TOOL_INPUTS.get_context.strict(),
  get_outline: TOOL_INPUTS.get_outline.strict(),
  read_pdf_pages: TOOL_INPUTS.read_pdf_pages.strict(),
} satisfies Record<TutorTool, z.ZodObject>;

export const TOOL_DESCRIPTIONS: Record<TutorTool, string> = {
  get_context: 'Where the user is and what they attached, as of the question.',
  get_outline: 'The document\'s table of contents with page numbers.',
  read_pdf_pages: `Text of pages from..to (1-based), at most ${TUTOR_LIMITS.pagesPerCall} pages per call. Each page comes with its cite token.`,
};

/** On all three tools: harmless for Claude, and what a later read-only agent needs before it runs a tool unasked. */
export const TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export interface ToolDeps {
  text: Pick<TextRepository, 'pages' | 'stateOf'>;
  prioritize(sha256: string): void;
  delay(ms: number): Promise<void>;
  now(): number;
}

export interface ToolCallResult {
  isError: boolean;
  /** The one human-readable text block. */
  text: string;
  /** structuredContent, when the MCP version takes it. */
  envelope: TutorEnvelope | null;
  /** The tool_reads row; null when there is no answer to record it on. */
  read: ToolReadInput | null;
}

/** Why a read was not ok, as tool_reads keeps it. */
type ReadCode =
  | 'BAD_ARGS' | 'OUT_OF_SCOPE' | 'PAGE_BUDGET' | 'TEXT_PENDING' | 'BEYOND_INDEX'
  | 'TEXT_EMPTY' | 'TEXT_LOCKED' | 'TEXT_DAMAGED' | 'TEXT_TOO_LARGE' | 'TEXT_GAVE_UP';

/** What the model reads: English, like the tool descriptions. */
const SAY = {
  outside: 'This material is outside this conversation.',
  badArgs: 'Invalid arguments.',
  ended: 'This question has ended; the result was not kept.',
  pending: 'Page text is still being prepared; try again in a moment.',
  noText: (why: string) => `This PDF has no readable text (${why}).`,
  beyond: 'This page is beyond the part of the PDF whose text Learn indexed.',
  budget: `Page budget for this question is used up (${TUTOR_LIMITS.pagesPerTurn} pages). Answer with what you have read.`,
  duplicate: 'already returned earlier in this conversation',
  truncated: `truncated to ${TUTOR_LIMITS.charsPerPage} characters`,
  noOutline: 'No outline: read from page 1 or from the page the user is on.',
  outlineCut: `outline shortened to its first ${TUTOR_LIMITS.outlineEntries} entries`,
  outlineLoading: 'outline still loading: some entries have no page yet',
  citeFirst: (n: number) => `To cite page ${n}, read it with read_pdf_pages first.`,
} as const;

const NO_TEXT: Record<'empty' | BodyTextFailure, { why: string; code: ReadCode }> = {
  empty: { why: 'no text layer', code: 'TEXT_EMPTY' },
  locked: { why: 'password-protected', code: 'TEXT_LOCKED' },
  damaged: { why: 'damaged', code: 'TEXT_DAMAGED' },
  'too-large': { why: 'too large', code: 'TEXT_TOO_LARGE' },
  'gave-up': { why: 'could not be read', code: 'TEXT_GAVE_UP' },
};

const PENDING_POLL_MS = 250;

type ReadArgs = z.infer<typeof TOOL_INPUTS.read_pdf_pages>;
type Row = Omit<ToolReadInput, 'tool' | 'ms'>;
/** A result before the turn is checked: `commit` marks its pages returned once it is known to be kept. */
interface Built { isError: boolean; text: string; envelope: TutorEnvelope | null; row: Row; commit?: () => void }

const isTutorTool = (name: string): name is TutorTool => (TUTOR_TOOLS as readonly string[]).includes(name);
const yesNo = (b: boolean): string => (b ? 'yes' : 'no');
const provenance = (s: AcpScope): TutorEnvelope['provenance'] => ({ revisionId: s.revisionId, sha256: s.sha256, parser: PDF_TEXT_EXTRACTOR });
const itemOf = (s: AcpScope): TutorEnvelope['item'] => ({ id: s.itemId, title: wrapMaterial(s.title, s.nonce, 'title') });
const row = (outcome: ToolOutcome, revisionId: string | null, errorCode: ReadCode | null, rest: Partial<Row> = {}): Row => ({
  outcome, revisionId, pageFrom: null, pageTo: null, duplicatePages: 0, chars: 0, errorCode, ...rest,
});
const failed = (text: string, r: Row): Built => ({ isError: true, text, envelope: null, row: r });

/** At most `n` UTF-16 units, never ending inside a surrogate pair. */
function cut(text: string, n: number): string {
  if (text.length <= n) return text;
  const head = text.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

function getContext(scope: AcpScope, turn: ActiveTurn): Built {
  const it = itemOf(scope);
  const sel = turn.selection;
  const selection = sel === null ? null : { page: sel.anchor.pageIndex + 1, text: wrapMaterial(sel.text, scope.nonce, 'selection') };
  const lines = [
    `get_context · ${it.title} · item ${scope.itemId} · ${scope.pageCount} pages · materials in scope: 1`,
    `the user is on page ${scope.readerPage + 1}`,
    ...(selection === null
      ? ['attached selection: none']
      : [`attached selection · page ${selection.page}`, selection.text, SAY.citeFirst(selection.page)]),
  ];
  return {
    isError: false,
    text: lines.join('\n'),
    envelope: {
      tool: 'get_context', item: it,
      context: { pageCount: scope.pageCount, readerPage: scope.readerPage + 1, selection, materials: 1 },
      returned: 1, total: 1, limited: false, next: null, provenance: provenance(scope),
    },
    row: row('ok', scope.revisionId, null, { chars: sel?.text.length ?? 0 }),
  };
}

function getOutline(scope: AcpScope): Built {
  const it = itemOf(scope);
  const all = scope.outline.entries;
  const entries = all.slice(0, TUTOR_LIMITS.outlineEntries);
  const total = Math.max(scope.outline.total, all.length);
  const limited = total > TUTOR_LIMITS.outlineEntries;
  const outline = entries.map((e) => ({
    title: wrapMaterial(e.title, scope.nonce, 'outline'),
    depth: e.depth,
    page: e.pageIndex === null ? null : e.pageIndex + 1,
    cite: e.pageIndex === null ? null : citeToken(e.pageIndex),
  }));
  const lines = [`get_outline · ${it.title} · returned ${entries.length} of ${total} entries · limited: ${yesNo(limited)} · next: none`];
  if (entries.length === 0) lines.push(SAY.noOutline);
  else {
    if (limited) lines.push(SAY.outlineCut);
    if (!scope.outline.complete) lines.push(SAY.outlineLoading);
    outline.forEach((e, k) => {
      lines.push(`entry ${k + 1} · depth ${e.depth} · ${e.page === null ? 'no page' : `page ${e.page} · cite ${e.cite}`}`, e.title);
    });
  }
  return {
    isError: false,
    text: lines.join('\n'),
    envelope: { tool: 'get_outline', item: it, outline, returned: entries.length, total, limited, next: null, provenance: provenance(scope) },
    row: row(limited ? 'limited' : 'ok', scope.revisionId, null, { chars: entries.reduce((n, e) => n + e.title.length, 0) }),
  };
}

/** Waits (at most pendingWaitMs) for the first asked page of a PDF whose text is pending; stops early when the turn ends. */
async function awaitText(scope: AcpScope, first: number, deps: ToolDeps, current: () => boolean) {
  let state = deps.text.stateOf(scope.sha256);
  if (state.state !== 'pending') return state;
  deps.prioritize(scope.sha256);
  const until = deps.now() + TUTOR_LIMITS.pendingWaitMs;
  const arrived = () => deps.text.pages(scope.sha256, first, first).length > 0;
  while (state.state === 'pending' && !arrived() && current() && deps.now() < until) {
    await deps.delay(PENDING_POLL_MS);
    state = deps.text.stateOf(scope.sha256);
  }
  return state;
}

/**
 * The asked pages from the first on, as far as every limit allows: five a call, 24,000 characters a call (whole pages),
 * 12,000 a page (cut), the turn's 40 new pages. A page this ACP session already returned comes back as a duplicate,
 * without its text. What comes back is always one contiguous run from the first asked page, and that run is what the
 * read records — the citation check counts every page in it as returned.
 */
function readPages(scope: AcpScope, turn: ActiveTurn, args: ReadArgs, deps: ToolDeps, pending: boolean): Built {
  const first = args.from - 1;
  const last = (args.to ?? args.from) - 1;
  const rows = new Map(deps.text.pages(scope.sha256, first, Math.min(last, first + TUTOR_LIMITS.pagesPerCall - 1)).map((r) => [r.pageIndex, r.text]));
  const remaining = Math.max(0, TUTOR_LIMITS.pagesPerTurn - turn.pagesReturned);
  const out: Array<{ pageIndex: number; text: string | null; truncated: boolean }> = [];
  let chars = 0;
  let fresh = 0;
  let stop: { at: number; why: 'call' | 'budget' | 'pending' | 'beyond' } | null = null;
  for (let p = first; p <= last; p += 1) {
    if (out.length === TUTOR_LIMITS.pagesPerCall) {
      stop = { at: p, why: 'call' };
      break;
    }
    const text = rows.get(p);
    if (text === undefined) {
      stop = { at: p, why: pending ? 'pending' : 'beyond' };
      break;
    }
    if (scope.returnedPages.has(p)) {
      out.push({ pageIndex: p, text: null, truncated: false });
      continue;
    }
    if (fresh >= remaining) {
      stop = { at: p, why: 'budget' };
      break;
    }
    const kept = cut(text, TUTOR_LIMITS.charsPerPage);
    if (chars + kept.length > TUTOR_LIMITS.charsPerCall) {
      stop = { at: p, why: 'call' };
      break;
    }
    chars += kept.length;
    fresh += 1;
    out.push({ pageIndex: p, text: kept, truncated: kept.length < text.length });
  }

  if (out.length === 0) {
    if (stop?.why === 'budget') return failed(SAY.budget, row('refused', scope.revisionId, 'PAGE_BUDGET'));
    if (stop?.why === 'pending') return failed(SAY.pending, row('pending', scope.revisionId, 'TEXT_PENDING'));
    return failed(SAY.beyond, row('failed', scope.revisionId, 'BEYOND_INDEX'));
  }

  const it = itemOf(scope);
  const limited = stop !== null;
  const next = stop !== null && (stop.why === 'call' || stop.why === 'pending') ? { from: stop.at + 1 } : null;
  const pages = out.map((o) => ({
    anchor: { kind: 'pdf' as const, revisionId: scope.revisionId, precision: 'page' as const, pageIndex: o.pageIndex },
    label: mainStrings.tutor.pageLabel(o.pageIndex + 1),
    cite: citeToken(o.pageIndex),
    text: o.text === null ? null : wrapMaterial(o.text, scope.nonce, { page: o.pageIndex + 1 }),
    duplicate: o.text === null,
    truncated: o.truncated,
  }));
  const lines = [
    `read_pdf_pages · ${it.title} · returned ${out.length} of ${scope.pageCount} pages · limited: ${yesNo(limited)} · next: ${next === null ? 'none' : `from ${next.from}`}`,
  ];
  for (const p of pages) {
    const head = `page ${p.anchor.pageIndex + 1} · cite ${p.cite}`;
    if (p.text === null) lines.push(`${head} · ${SAY.duplicate}`);
    else lines.push(p.truncated ? `${head} · ${SAY.truncated}` : head, p.text);
  }
  if (stop?.why === 'budget') lines.push(SAY.budget);
  if (stop?.why === 'beyond') lines.push(`page ${stop.at + 1} · ${SAY.beyond}`);
  if (stop?.why === 'pending') lines.push(`page ${stop.at + 1} · ${SAY.pending}`);
  const duplicates = pages.filter((p) => p.duplicate).length;
  const newPages = out.filter((o) => o.text !== null).map((o) => o.pageIndex);
  return {
    isError: false,
    text: lines.join('\n'),
    envelope: { tool: 'read_pdf_pages', item: it, pages, returned: out.length, total: scope.pageCount, limited, next, provenance: provenance(scope) },
    row: row(duplicates === out.length ? 'duplicate' : limited ? 'limited' : 'ok', scope.revisionId, null, {
      pageFrom: first, pageTo: first + out.length - 1, duplicatePages: duplicates, chars,
    }),
    commit: () => {
      for (const p of newPages) scope.returnedPages.add(p);
      turn.pagesReturned += newPages.length;
    },
  };
}

/**
 * One tool call of an ACP session; the result is kept only if the call's question is still the scope's when it is ready.
 * `onStart` is called once for every call that has a question to answer — refused and bad-argument calls included —
 * with the asked range for read_pdf_pages (null otherwise). Its chip's outcome is a placeholder, not yet known:
 * consumers tell a running chip by the event's `running` flag, never by the outcome.
 */
export async function callTool(
  scope: AcpScope, name: string, rawArgs: unknown, deps: ToolDeps, onStart?: (chip: ToolChip) => void,
): Promise<ToolCallResult> {
  if (!isTutorTool(name)) throw new LearnError('VALIDATION_FAILED', 'Unknown tool.');
  const tool = name;
  const started = deps.now();
  const parsed = TOOL_INPUTS[tool].safeParse(rawArgs === undefined ? {} : rawArgs);
  const args = parsed.success ? (parsed.data as { item?: string; from?: number; to?: number }) : null;
  const verdict = guardToolArgs(scope, args ?? {});
  const turn = scope.activeTurn;
  if (turn === null || (!verdict.ok && verdict.code === 'NO_TURN')) return { isError: true, text: SAY.outside, envelope: null, read: null };

  const messageId = turn.tutorMessageId;
  const current = (): boolean => scope.activeTurn?.tutorMessageId === messageId;
  const asked = tool === 'read_pdf_pages' && args?.from !== undefined ? { from: args.from - 1, to: (args.to ?? args.from) - 1 } : null;
  onStart?.({ tool, outcome: 'ok', pageFrom: asked?.from ?? null, pageTo: asked?.to ?? null, withSelection: turn.selection !== null });

  // The question ended (stopped, failed, or another began) before the result was ready: nothing is kept or recorded.
  const ended = (): ToolCallResult => ({ isError: true, text: SAY.ended, envelope: null, read: null });
  const finish = (b: Built): ToolCallResult => {
    if (!current()) return ended();
    b.commit?.();
    return { isError: b.isError, text: b.text, envelope: b.envelope, read: { tool, ...b.row, ms: Math.max(0, Math.round(deps.now() - started)) } };
  };

  const outside = (): Built => failed(SAY.outside, row('refused', null, 'OUT_OF_SCOPE'));
  if (args === null) return finish(failed(SAY.badArgs, row('failed', null, 'BAD_ARGS')));
  if (!verdict.ok) return finish(outside());
  if (tool === 'get_context') return finish(guardPromptSelection(scope, turn.selection).ok ? getContext(scope, turn) : outside());
  if (tool === 'get_outline') return finish(getOutline(scope));

  const read = args as ReadArgs;
  // A used-up budget cannot return a new page: refused before the scheduler is asked or anything is waited for.
  if (turn.pagesReturned >= TUTOR_LIMITS.pagesPerTurn && !scope.returnedPages.has(read.from - 1)) {
    return finish(failed(SAY.budget, row('refused', scope.revisionId, 'PAGE_BUDGET')));
  }
  const state = await awaitText(scope, read.from - 1, deps, current);
  const still = scope.activeTurn;
  if (still === null || !current()) return ended();
  if (state.state === 'empty' || state.state === 'failed') {
    const why = NO_TEXT[state.state === 'empty' ? 'empty' : state.reason];
    return finish(failed(SAY.noText(why.why), row('failed', scope.revisionId, why.code)));
  }
  return finish(readPages(scope, still, read, deps, state.state === 'pending'));
}
