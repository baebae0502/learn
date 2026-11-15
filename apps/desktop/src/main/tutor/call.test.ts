import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsRepository, TextRepository, type Db } from '@learn/db';
import { extractKey, newId, nowIso, type TutorTurnEvent } from '@learn/domain';
import { freshDb, seedItem } from '../../../../../packages/db/test/fixtures';
import { createTutorCall } from './call';
import { createScopeRegistry, type AcpScope } from './scope';
import type { ToolDeps } from './tools';

/*
 * main's tutorCall: Learn's MCP server calls a tool through it. The read callTool makes is recorded on the answer of the
 * question that was being answered when the call came in, through the repository — so every ToolReadInput callTool can
 * produce must pass the repository's own schema (the two shapes must not drift).
 */

const PAGES = 6;
let db: Db;
let repo: ConversationsRepository;
let scope: AcpScope;
let tutorMessageId: string;
let conversationId: string;
let events: TutorTurnEvent[];
let deps: ToolDeps;
let other: string;

function seedPages(sha256: string, pages: number): void {
  const insert = db.prepare('INSERT INTO page_texts (sha256, page_index, text) VALUES (?, ?, ?)');
  let chars = 0;
  for (let p = 0; p < pages; p += 1) {
    const text = `Page ${p + 1} holds an ordinary paragraph about cells and their signals, long enough to be read as text.`;
    chars += text.length;
    insert.run(sha256, p, text);
  }
  const now = nowIso();
  db.prepare(`INSERT INTO jobs (id, kind, dedupe_key, state, attempts, progress, payload_json, created_at, updated_at) VALUES (?, 'extract', ?, 'done', 1, 1, ?, ?, ?)`)
    .run(newId(), extractKey(sha256), JSON.stringify({ sha256, type: 'pdf', nextPage: pages, pages, chars, truncated: false }), now, now);
}

function call() {
  return createTutorCall({ deps, conversations: () => repo, emitTurn: (e) => events.push(e), now: nowIso });
}

beforeEach(() => {
  db = freshDb();
  repo = new ConversationsRepository(db);
  const item = seedItem(db, { title: 'Cells' });
  other = seedItem(db, { title: 'Other' }).itemId;
  seedPages(item.asset.sha256, PAGES);
  const b = repo.beginTurn({
    conversationId: null, itemId: item.itemId, revisionId: item.revisionId, agent: 'fake', openedAtPage: 0,
    user: { kind: 'question', text: '무엇을 다루나요?', sent: { selection: 0, replayedTurns: 0, preamble: true }, attached: null }, now: nowIso(),
  });
  tutorMessageId = b.tutorMessageId;
  conversationId = b.conversationId;
  scope = createScopeRegistry().open({
    // The reader counts more pages than the index holds (a text cut short): a page past the index is in scope.
    conversationId, itemId: item.itemId, revisionId: item.revisionId, sha256: item.asset.sha256, title: 'Cells', pageCount: PAGES + 4,
    outline: { entries: [{ title: 'One', depth: 0, pageIndex: 0 }], complete: true, total: 1 }, readerPage: 0, bindMcpSession: true,
  });
  scope.activeTurn = { tutorMessageId, selection: null, pagesReturned: 0 };
  events = [];
  deps = { text: new TextRepository(db), prioritize: vi.fn(), delay: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() };
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

const rows = () => repo.toolReads(tutorMessageId).map((r) => [r.tool, r.outcome, r.pageFrom, r.pageTo, r.errorCode]);

describe('tutorCall', () => {
  it('every kind of read callTool makes is recorded by the repository on the answer being written', async () => {
    const run = call();
    await run(scope, 'get_context', {});
    await run(scope, 'get_outline', {});
    await run(scope, 'read_pdf_pages', { from: 1, to: 2 });
    await run(scope, 'read_pdf_pages', { from: 1 }); // returned already: a duplicate
    await run(scope, 'read_pdf_pages', { item: other, from: 1 }); // another material
    await run(scope, 'read_pdf_pages', { from: 0 }); // bad arguments
    await run(scope, 'read_pdf_pages', { from: PAGES + 1 }); // past the indexed text
    expect(rows()).toEqual([
      ['get_context', 'ok', null, null, null],
      ['get_outline', 'ok', null, null, null],
      ['read_pdf_pages', 'ok', 0, 1, null],
      ['read_pdf_pages', 'duplicate', 0, 0, null],
      ['read_pdf_pages', 'refused', null, null, 'OUT_OF_SCOPE'],
      ['read_pdf_pages', 'failed', null, null, 'BAD_ARGS'],
      ['read_pdf_pages', 'failed', null, null, 'BEYOND_INDEX'],
    ]);
  });

  it('tells the main window the chip running, then the chip as recorded', async () => {
    const r = await call()(scope, 'read_pdf_pages', { from: 2, to: 3 });
    expect(r.isError).toBe(false);
    expect(events).toEqual([
      { conversationId, messageId: tutorMessageId, kind: 'tool', running: true, chip: { tool: 'read_pdf_pages', outcome: 'ok', pageFrom: 1, pageTo: 2, withSelection: false } },
      { conversationId, messageId: tutorMessageId, kind: 'tool', running: false, chip: { tool: 'read_pdf_pages', outcome: 'ok', pageFrom: 1, pageTo: 2, withSelection: false } },
    ]);
    // The refused call has its chip too: the user sees the agent asked.
    events.length = 0;
    await call()(scope, 'read_pdf_pages', { item: other, from: 1 });
    expect(events.map((e) => (e.kind === 'tool' ? [e.running, e.chip.outcome] : e.kind))).toEqual([[true, 'ok'], [false, 'refused']]);
  });

  it('a result that comes after its question ended is answered but recorded nowhere', async () => {
    // A PDF whose text is still pending: the read waits, and the question ends meanwhile.
    const pending = seedItem(db, { title: 'Pending' });
    const b = repo.beginTurn({
      conversationId: null, itemId: pending.itemId, revisionId: pending.revisionId, agent: 'fake', openedAtPage: 0,
      user: { kind: 'question', text: '기다리는 질문', sent: { selection: 0, replayedTurns: 0, preamble: true }, attached: null }, now: nowIso(),
    });
    const s = createScopeRegistry().open({
      conversationId: b.conversationId, itemId: pending.itemId, revisionId: pending.revisionId, sha256: pending.asset.sha256, title: 'Pending', pageCount: 3,
      outline: { entries: [], complete: true, total: 0 }, readerPage: 0, bindMcpSession: true,
    });
    s.activeTurn = { tutorMessageId: b.tutorMessageId, selection: null, pagesReturned: 0 };
    let waits = 0;
    deps.delay = async () => {
      waits += 1;
      // The next question begins while this read waits for the text.
      s.activeTurn = { tutorMessageId: tutorMessageId, selection: null, pagesReturned: 0 };
    };
    const r = await call()(s, 'read_pdf_pages', { from: 1 });
    expect(waits).toBe(1);
    expect(r).toMatchObject({ isError: true, read: null });
    expect(repo.toolReads(b.tutorMessageId)).toEqual([]);
    expect(repo.toolReads(tutorMessageId)).toEqual([]);
    expect(events.map((e) => [e.messageId, e.kind === 'tool' && e.running])).toEqual([[b.tutorMessageId, true]]);
  });

  it('no question being answered: nothing is told or recorded', async () => {
    scope.activeTurn = null;
    const r = await call()(scope, 'read_pdf_pages', { from: 1 });
    expect(r).toMatchObject({ isError: true, read: null });
    expect(events).toEqual([]);
    expect(rows()).toEqual([]);
  });

  it('a read that cannot be recorded (its answer row is gone) still answers the agent, and the log has the code only', async () => {
    const user = repo.thread(conversationId).messages[0]!.id;
    repo.dropBeforeAnswer(user, tutorMessageId);
    const r = await call()(scope, 'read_pdf_pages', { from: 1 });
    expect(r.isError).toBe(false);
    expect(r.read).not.toBeNull();
    expect(events.map((e) => e.kind === 'tool' && e.running)).toEqual([true]);
    expect(vi.mocked(console.info).mock.calls.map((c) => c[0])).toEqual(['[tutor] tool-read-failed code=NOT_FOUND']);
  });
});
