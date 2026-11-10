import { describe, expect, it } from 'vitest';
import { newId, type PdfSpanAnchor } from '@learn/domain';
import { ConversationsRepository, purgeTrash, type BeginTurnInput, type Db, type FinishTurnInput, type ToolReadInput } from '../src/index';
import { expectLearnError, freshDb, seedItem } from './fixtures';

const SENT = { selection: 0, replayedTurns: 0, preamble: true } as const;
const NOW = '2026-11-10T09:31:00.000Z';
function begin(repo: ConversationsRepository, s: { itemId: string; revisionId: string }, over: Partial<BeginTurnInput> = {}) {
  return repo.beginTurn({ conversationId: null, itemId: s.itemId, revisionId: s.revisionId, agent: 'fake', openedAtPage: 3,
    user: { kind: 'question', text: '어텐션이 뭐야?\n둘째 줄', sent: SENT, attached: null }, now: NOW, ...over });
}
const FINISH: Omit<FinishTurnInput, 'revisionId'> = { status: 'complete', text: 'A', stopReason: 'end_turn', errorCode: null, verified: [] };
const done = (repo: ConversationsRepository, s: { revisionId: string }, id: string) => repo.finishTurn(id, { ...FINISH, revisionId: s.revisionId }, NOW);
const failed = (repo: ConversationsRepository, s: { revisionId: string }, id: string, errorCode: 'AGENT_EXITED' | 'AGENT_LOCKDOWN' = 'AGENT_EXITED', text = '') =>
  repo.finishTurn(id, { status: 'failed', text, stopReason: null, errorCode, revisionId: s.revisionId, verified: [] }, NOW);
const count = (db: Db, sql: string) => db.prepare(sql).pluck().get() as number;
const spanAnchor = (revisionId: string): PdfSpanAnchor => ({ kind: 'pdf', revisionId, precision: 'span', pageIndex: 41, quads: [[0, 0, 1, 0, 0, 1, 1, 1]], coordinateSpace: 'pdf-user-space', text: { quote: { exact: 'q', prefix: '', suffix: '' } } });
const tool = (over: Partial<ToolReadInput> = {}): ToolReadInput => ({ tool: 'read_pdf_pages', outcome: 'ok', revisionId: null, pageFrom: 1, pageTo: 2, duplicatePages: 0, chars: 10, errorCode: null, ms: 5, ...over });
const at = (n: number) => `2026-11-10T09:${String(n).padStart(2, '0')}:00.000Z`;

describe('ConversationsRepository', () => {
  it('makes the conversation with its first question, opened at the page the user was on', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    expect(t.created).toBe(true);
    const thread = repo.thread(t.conversationId);
    expect(thread.session).toMatchObject({ itemId: s.itemId, title: '어텐션이 뭐야?', renamed: false, agent: 'fake', mixedAgents: false });
    expect(thread.messages.map((m) => [m.role, m.kind, m.status, m.seq])).toEqual([['user', 'question', 'complete', 0], ['tutor', 'answer', 'streaming', 1]]);
    const opened = db.prepare(`SELECT a.locator_json FROM conversation_context c JOIN anchors a ON a.id = c.anchor_id WHERE c.conversation_id = ? AND c.role = 'opened_from'`).pluck().get(t.conversationId) as string;
    expect(JSON.parse(opened)).toEqual({ kind: 'pdf', revisionId: s.revisionId, precision: 'page', pageIndex: 3 });
  });

  it('a failure before the answer leaves no row, no empty conversation and no orphan span anchor', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const anchor = spanAnchor(s.revisionId);
    const t = begin(repo, s, { user: { kind: 'question', text: 'q', sent: { ...SENT, selection: 1 }, attached: { anchor, quote: 'q', label: '42쪽' } } });
    expect(repo.dropBeforeAnswer(t.userMessageId, t.tutorMessageId)).toEqual({ conversationDeleted: true });
    for (const table of ['conversations', 'messages', 'message_sources', 'conversation_context']) expect(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get(), table).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) FROM anchors WHERE precision = 'span'`).pluck().get()).toBe(0);
  });

  it('finishes with the verified pages as cited sources, one page anchor per page, and the sources survive their anchor', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    const chips = repo.finishTurn(t.tutorMessageId, { status: 'complete', text: 'A [[p42]] B [[p43]]', stopReason: 'end_turn', errorCode: null, revisionId: s.revisionId,
      verified: [{ pageIndex: 41, label: '42쪽' }, { pageIndex: 42, label: '43쪽' }] }, NOW);
    expect(chips.map((c) => [c.pageIndex, c.label])).toEqual([[41, '42쪽'], [42, '43쪽']]);
    const again = begin(repo, s, { conversationId: t.conversationId });
    repo.finishTurn(again.tutorMessageId, { status: 'complete', text: '[[p42]]', stopReason: 'end_turn', errorCode: null, revisionId: s.revisionId, verified: [{ pageIndex: 41, label: '42쪽' }] }, NOW);
    expect(db.prepare(`SELECT COUNT(*) FROM anchors WHERE precision = 'page' AND json_extract(locator_json, '$.pageIndex') = 41`).pluck().get()).toBe(1);
    db.prepare(`DELETE FROM anchors WHERE precision = 'page' AND json_extract(locator_json, '$.pageIndex') = 41`).run();
    expect(repo.thread(t.conversationId).messages[1]!.sources[0]).toMatchObject({ pageIndex: 41, label: '42쪽', anchorId: null, revisionId: null });
  });

  it('keeps the partial answer: two saves leave the last text and the row streaming', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    repo.saveText(t.tutorMessageId, '앞', NOW);
    repo.saveText(t.tutorMessageId, '앞 뒤', NOW);
    expect(repo.message(t.tutorMessageId)).toMatchObject({ text: '앞 뒤', status: 'streaming' });
  });

  it('a resend replaces the failed answer with a streaming row of the same seq, and its tool reads go', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    repo.addToolRead(t.tutorMessageId, tool(), NOW);
    failed(repo, s, t.tutorMessageId);
    const r = repo.retryTurn(t.tutorMessageId, 'fake', NOW);
    expect(r).toMatchObject({ conversationId: t.conversationId, userMessageId: t.userMessageId });
    expect(r.tutorMessageId).not.toBe(t.tutorMessageId);
    expect(repo.message(t.tutorMessageId)).toBeUndefined();
    expect(repo.message(r.tutorMessageId)).toMatchObject({ seq: 1, status: 'streaming', text: '' });
    expect(count(db, `SELECT COUNT(*) FROM messages WHERE role = 'tutor'`)).toBe(1);
    expect(count(db, 'SELECT COUNT(*) FROM tool_reads')).toBe(0);
    // a complete answer and a lockdown answer are not resent
    done(repo, s, r.tutorMessageId);
    expectLearnError(() => repo.retryTurn(r.tutorMessageId, 'fake', NOW), 'VALIDATION_FAILED');
    const second = begin(repo, s, { conversationId: t.conversationId });
    failed(repo, s, second.tutorMessageId, 'AGENT_LOCKDOWN');
    expectLearnError(() => repo.retryTurn(second.tutorMessageId, 'fake', NOW), 'VALIDATION_FAILED');
  });

  it('a resend that fails before its answer is left as a failed row, so it can be resent again', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    failed(repo, s, t.tutorMessageId);
    const r = repo.retryTurn(t.tutorMessageId, 'fake', NOW);
    failed(repo, s, r.tutorMessageId, 'AGENT_EXITED', '');
    expect(repo.message(r.userMessageId)).toMatchObject({ role: 'user', status: 'complete' });
    expect(repo.conversation(t.conversationId)).toBeDefined();
    expect(repo.message(r.tutorMessageId)).toMatchObject({ status: 'failed', errorCode: 'AGENT_EXITED', text: '' });
    const again = repo.retryTurn(r.tutorMessageId, 'fake', NOW);
    expect(repo.message(again.tutorMessageId)).toMatchObject({ seq: 1, status: 'streaming' });
  });

  it('a dropped reground pair takes only its two rows; the earlier question, answer and conversation stay', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    done(repo, s, t.tutorMessageId);
    const g = begin(repo, s, { conversationId: t.conversationId, user: { kind: 'reground', text: '원문으로 확인해 줘', sent: SENT, attached: null } });
    expect(repo.dropBeforeAnswer(g.userMessageId, g.tutorMessageId)).toEqual({ conversationDeleted: false });
    expect(repo.thread(t.conversationId).messages.map((m) => [m.role, m.seq])).toEqual([['user', 0], ['tutor', 1]]);
  });

  it('a reground turn joins the same conversation at seq 2 and 3', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    done(repo, s, t.tutorMessageId);
    const g = begin(repo, s, { conversationId: t.conversationId, user: { kind: 'reground', text: '확인', sent: SENT, attached: null } });
    expect(g).toMatchObject({ conversationId: t.conversationId, created: false });
    expect(repo.thread(t.conversationId).messages.map((m) => [m.kind, m.seq])).toEqual([['question', 0], ['answer', 1], ['reground', 2], ['answer', 3]]);
  });

  it('rejects a conversation of another item, a deleted one and an unknown one', () => {
    const db = freshDb(); const s = seedItem(db); const other = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    expectLearnError(() => begin(repo, other, { conversationId: t.conversationId }), 'VALIDATION_FAILED');
    expectLearnError(() => begin(repo, s, { conversationId: newId() }), 'VALIDATION_FAILED');
    repo.remove(t.conversationId, NOW);
    expectLearnError(() => begin(repo, s, { conversationId: t.conversationId }), 'VALIDATION_FAILED');
    expect(count(db, 'SELECT COUNT(*) FROM messages')).toBe(2);
  });

  it('records tool reads in order; the chip knows whether a selection came with the question; a half range is refused', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const plain = begin(repo, s);
    const chips = [tool(), tool({ outcome: 'duplicate', duplicatePages: 2 }), tool({ tool: 'get_outline', pageFrom: null, pageTo: null })].map((r) => repo.addToolRead(plain.tutorMessageId, r, NOW));
    expect(repo.toolReads(plain.tutorMessageId).map((r) => [r.seq, r.tool, r.outcome])).toEqual([[0, 'read_pdf_pages', 'ok'], [1, 'read_pdf_pages', 'duplicate'], [2, 'get_outline', 'ok']]);
    expect(chips.map((c) => c.withSelection)).toEqual([false, false, false]);
    expect(chips[0]).toEqual({ tool: 'read_pdf_pages', outcome: 'ok', pageFrom: 1, pageTo: 2, withSelection: false });
    const picked = begin(repo, s, { conversationId: plain.conversationId, user: { kind: 'question', text: 'q', sent: { ...SENT, selection: 1 }, attached: { anchor: spanAnchor(s.revisionId), quote: 'q', label: '42쪽' } } });
    expect(repo.addToolRead(picked.tutorMessageId, tool(), NOW).withSelection).toBe(true);
    expect(repo.thread(plain.conversationId).messages[3]!.tools).toHaveLength(1);
    expectLearnError(() => repo.addToolRead(plain.tutorMessageId, tool({ pageTo: null }), NOW), 'VALIDATION_FAILED');
    expectLearnError(() => repo.addToolRead(plain.tutorMessageId, tool({ pageFrom: 5, pageTo: 2 }), NOW), 'VALIDATION_FAILED');
  });

  it('replays the question and answer pairs before a seq, without a failed answer or its question', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const a = begin(repo, s, { user: { kind: 'question', text: 'Q1', sent: SENT, attached: null } });
    repo.finishTurn(a.tutorMessageId, { ...FINISH, text: 'A1', revisionId: s.revisionId }, NOW);
    const b = begin(repo, s, { conversationId: a.conversationId, user: { kind: 'question', text: 'Q2', sent: SENT, attached: null } });
    failed(repo, s, b.tutorMessageId, 'AGENT_EXITED', 'partial');
    const c = begin(repo, s, { conversationId: a.conversationId, user: { kind: 'reground', text: 'G3', sent: SENT, attached: null } });
    repo.finishTurn(c.tutorMessageId, { ...FINISH, status: 'stopped', stopReason: 'cancelled', text: 'A3', revisionId: s.revisionId }, NOW);
    const d = begin(repo, s, { conversationId: a.conversationId, user: { kind: 'question', text: 'Q4', sent: SENT, attached: null } });
    expect(repo.replayTurns(a.conversationId, repo.message(d.userMessageId)!.seq)).toEqual([{ question: 'Q1', answer: 'A1' }, { question: 'G3', answer: 'A3' }]);
    expect(repo.replayTurns(a.conversationId, 2)).toEqual([{ question: 'Q1', answer: 'A1' }]);
  });

  it('renames, goes back to the first line, deletes with undo, and follows its item into the trash', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    expectLearnError(() => repo.rename(t.conversationId, '  ', NOW), 'VALIDATION_FAILED');
    expect(repo.rename(t.conversationId, '  내 이름 ', at(40))).toMatchObject({ title: '내 이름', renamed: true, updatedAt: at(40) });
    expect(repo.rename(t.conversationId, null, at(41))).toMatchObject({ title: '어텐션이 뭐야?', renamed: false });
    repo.remove(t.conversationId, NOW);
    expect(repo.list(s.itemId)).toEqual([]);
    expectLearnError(() => repo.thread(t.conversationId), 'NOT_FOUND');
    repo.restore(t.conversationId);
    expect(repo.list(s.itemId).map((x) => x.id)).toEqual([t.conversationId]);
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(NOW, s.itemId);
    expect(repo.list(s.itemId)).toEqual([]);
    expect(repo.recent().groups).toEqual([]);
    expectLearnError(() => repo.thread(t.conversationId), 'NOT_FOUND');
    expect(repo.conversation(t.conversationId)).toMatchObject({ deleted: false, itemTrashed: true });
    db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?').run(s.itemId);
    expect(repo.list(s.itemId)).toHaveLength(1);
    expect(repo.recent().groups).toHaveLength(1);
  });

  it('marks a session mixed when its answers came from more than one agent', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const t = begin(repo, s);
    done(repo, s, t.tutorMessageId);
    expect(repo.list(s.itemId)[0]!.mixedAgents).toBe(false);
    const u = begin(repo, s, { conversationId: t.conversationId, agent: 'claude' });
    done(repo, s, u.tutorMessageId);
    expect(repo.list(s.itemId)[0]!.mixedAgents).toBe(true);
    repo.setAgentSession(t.conversationId, 'claude', 'sess-1', NOW);
    expect(repo.conversation(t.conversationId)).toMatchObject({ agent: 'claude', agentSessionId: 'sess-1' });
  });

  it('keeps what was sent and the passage a question carried, for a resend', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const anchor = spanAnchor(s.revisionId);
    const t = begin(repo, s, { user: { kind: 'question', text: 'q', sent: { ...SENT, selection: 1 }, attached: { anchor, quote: '인용문', label: '42쪽' } } });
    repo.setSent(t.userMessageId, { selection: 1, replayedTurns: 2, preamble: false });
    const [user] = repo.thread(t.conversationId).messages;
    expect(user).toMatchObject({ sent: { selection: 1, replayedTurns: 2, preamble: false }, attached: { pageIndex: 41, label: '42쪽', quote: '인용문' } });
    expect(user!.attached!.anchorId).toEqual(expect.any(String));
    expect(repo.attachedOf(t.userMessageId)).toEqual({ anchor, quote: '인용문', label: '42쪽' });
    expect(repo.attachedOf(begin(repo, s).userMessageId)).toBeNull();
  });

  it('turns an answer a quit cut off into an interrupted failure, keeping the text, and purges only the sessions deleted before this run', () => {
    const db = freshDb(); const s = seedItem(db); const repo = new ConversationsRepository(db);
    const withText = begin(repo, s); repo.saveText(withText.tutorMessageId, '받은 글', NOW);
    const empty = begin(repo, s);
    const old = begin(repo, s); repo.remove(old.conversationId, '2026-11-10T08:00:00.000Z');
    const recent = begin(repo, s); repo.remove(recent.conversationId, '2026-11-10T10:30:00.000Z');
    const r = repo.repairAtStartup(at(45), '2026-11-10T10:00:00.000Z');
    expect(r).toEqual({ interrupted: 4, purged: [old.conversationId] });
    expect(repo.message(withText.tutorMessageId)).toMatchObject({ status: 'failed', text: '받은 글', errorCode: null });
    expect(db.prepare('SELECT stop_reason, completed_at FROM messages WHERE id = ?').get(empty.tutorMessageId)).toEqual({ stop_reason: 'interrupted', completed_at: at(45) });
    expect(repo.conversation(old.conversationId)).toBeUndefined();
    expect(repo.conversation(recent.conversationId)).toBeDefined();
    expect(count(db, `SELECT COUNT(*) FROM messages WHERE conversation_id = '${old.conversationId}'`)).toBe(0);
  });

  it('a purged item takes its sessions with it, and another item\'s answer keeps its label when the page anchor goes', () => {
    const db = freshDb(); const s = seedItem(db); const other = seedItem(db); const repo = new ConversationsRepository(db);
    const a = begin(repo, s); const b = begin(repo, s);
    // another item's answer cites a page of the purged item's revision (T1b can do this)
    const o = begin(repo, other);
    repo.finishTurn(o.tutorMessageId, { ...FINISH, revisionId: s.revisionId, verified: [{ pageIndex: 7, label: '8쪽' }] }, NOW);
    expect(repo.thread(o.conversationId).messages[1]!.sources[0]!.anchorId).toEqual(expect.any(String));
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(NOW, s.itemId);
    const result = purgeTrash(db, { itemIds: [s.itemId], collectionIds: [] });
    expect(result.conversationIds.sort()).toEqual([a.conversationId, b.conversationId].sort());
    expect(count(db, `SELECT COUNT(*) FROM conversations WHERE item_id = '${s.itemId}'`)).toBe(0);
    expect(repo.thread(o.conversationId).messages[1]!.sources[0]).toMatchObject({ pageIndex: 7, label: '8쪽', anchorId: null, revisionId: null });
  });

  it('counts the sessions a purge takes, whatever state their item is in, and leaves out deleted sessions', () => {
    const db = freshDb(); const repo = new ConversationsRepository(db);
    const x = seedItem(db); const y = seedItem(db); const live = seedItem(db); const empty = seedItem(db);
    for (const it of [x, y]) db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(NOW, it.itemId);
    begin(repo, x); begin(repo, x);
    begin(repo, y); begin(repo, y); begin(repo, y); repo.remove(begin(repo, y).conversationId, NOW);
    begin(repo, live);
    void empty;
    expect(repo.purgeCount({ variant: 'items', itemIds: [x.itemId, y.itemId] })).toEqual({ sessions: 5, items: 2 });
    expect(repo.purgeCount({ variant: 'mixed', itemIds: [y.itemId] })).toEqual({ sessions: 3, items: 1 });
    expect(repo.purgeCount({ variant: 'empty', itemIds: [] })).toEqual({ sessions: 5, items: 2 });
    expect(repo.purgeCount({ variant: 'collections', itemIds: [x.itemId] })).toEqual({ sessions: 0, items: 0 });
    expect(repo.purgeCount({ variant: 'items', itemIds: [live.itemId] })).toEqual({ sessions: 1, items: 1 });
    expect(repo.purgeCount({ variant: 'items', itemIds: [empty.itemId] })).toEqual({ sessions: 0, items: 0 });
  });

  it('lists the newest first and groups the recent ones: five items of three sessions', () => {
    const db = freshDb(); const repo = new ConversationsRepository(db);
    const items = Array.from({ length: 6 }, () => seedItem(db));
    let n = 0;
    const ids: string[][] = items.map(() => []);
    for (let round = 0; round < 4; round++) {
      items.forEach((it, i) => { ids[i]!.push(begin(repo, it, { now: at(n++) , user: { kind: 'question', text: `q${i}-${round}`, sent: SENT, attached: null } }).conversationId); });
    }
    expect(repo.list(items[0]!.itemId).map((x) => x.id)).toEqual([...ids[0]!].reverse());
    const groups = repo.recent().groups;
    expect(groups.map((g) => g.item.id)).toEqual([5, 4, 3, 2, 1].map((i) => items[i]!.itemId));
    expect(groups[0]!.sessions.map((x) => x.id)).toEqual([...ids[5]!].reverse().slice(0, 3));
    expect(groups.every((g) => g.sessions.length === 3)).toBe(true);
    expect(groups[0]!.item).toEqual({ id: items[5]!.itemId, title: expect.any(String) });
  });
});
