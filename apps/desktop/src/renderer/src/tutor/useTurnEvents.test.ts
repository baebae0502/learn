import { describe, expect, it, vi } from 'vitest';
import type { MessageView, SessionThread, ToolChip, TutorTurnEvent } from '@learn/domain';

vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({}) }));

const { applyTurnEvent } = await import('./useTurnEvents');
const { liveOver } = await import('./useSessionThread');

const C = '8a6e1c52-2f3b-4d0e-9a41-7b5c3e2d1f00';
const M = '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11';
const read = (from: number, to = from, outcome: ToolChip['outcome'] = 'ok'): ToolChip => ({ tool: 'read_pdf_pages', outcome, pageFrom: from, pageTo: to, withSelection: false });
/** A notice's own part, each kind on its own (Omit over the union would merge them). */
type Body = TutorTurnEvent extends infer E ? (E extends TutorTurnEvent ? Omit<E, 'conversationId' | 'messageId'> : never) : never;
const ev = (e: Body & { messageId?: string }): TutorTurnEvent => ({ conversationId: C, messageId: M, ...e }) as TutorTurnEvent;

describe('the live turn: what the window heard of an answer still coming (P-16)', () => {
  it('appends the text, shows a tool while it runs and keeps it once recorded, its pages verified so far', () => {
    let live = applyTurnEvent(null, ev({ kind: 'tool', chip: read(41, 42), running: true }));
    expect(live).toMatchObject({ tutorMessageId: M, text: '', tools: [], running: read(41, 42) });
    expect([...live!.verifiedSoFar]).toEqual([]);
    live = applyTurnEvent(live, ev({ kind: 'tool', chip: read(41, 42), running: false }));
    expect(live).toMatchObject({ tools: [read(41, 42)], running: null });
    live = applyTurnEvent(live, ev({ kind: 'tool', chip: read(44, 44, 'duplicate'), running: false }));
    live = applyTurnEvent(live, ev({ kind: 'tool', chip: read(50, 50, 'refused'), running: false }));
    expect([...live!.verifiedSoFar].sort((a, b) => a - b)).toEqual([41, 42, 44]);
    live = applyTurnEvent(live, ev({ kind: 'text', append: '앞 ' }));
    live = applyTurnEvent(live, ev({ kind: 'text', append: '[[p42]]' }));
    expect(live!.text).toBe('앞 [[p42]]');
  });
  it('a notice of another answer starts that one over; the end of the turn leaves the live turn for the stored one to replace', () => {
    const first = applyTurnEvent(null, ev({ kind: 'text', append: 'a' }));
    const other = applyTurnEvent(first, ev({ kind: 'text', append: 'b', messageId: 'other' }));
    expect(other).toMatchObject({ tutorMessageId: 'other', text: 'b', tools: [] });
    expect(applyTurnEvent(first, ev({ kind: 'done', status: 'complete', stopReason: 'end_turn', sources: [] }))).toBe(first);
    expect(applyTurnEvent(first, ev({ kind: 'failed', phase: 'during', code: 'AGENT_EXITED' }))).toBe(first);
  });
});

const answer = (over: Partial<MessageView> = {}): MessageView => ({
  id: M, seq: 2, role: 'tutor', kind: 'answer', text: '', status: 'streaming', stopReason: null, errorCode: null, agent: 'fake', createdAt: '2026-11-12T00:00:00.000Z',
  attached: null, sources: [], tools: [], sent: null, ...over,
});
const thread = (...messages: MessageView[]): SessionThread => ({
  session: { id: C, itemId: 'i', title: 'q', renamed: false, agent: 'fake', mixedAgents: false, createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z' },
  item: { id: 'i', title: 'paper' },
  messages,
});

describe('which of the live and the stored answer is drawn', () => {
  const live = { tutorMessageId: M, text: '읽은 쪽을 바탕으로', tools: [read(41, 42)], running: null, verifiedSoFar: new Set([41, 42]) };
  it('the live one while it holds all the stored one has (the stored text is saved every 2 s, a prefix of it)', () => {
    expect(liveOver(null, live)).toBe(live);
    expect(liveOver(thread(), live)).toBe(live);
    expect(liveOver(thread(answer()), live)).toBe(live);
    expect(liveOver(thread(answer({ text: '읽은 쪽', tools: [read(41, 42)] })), live)).toBe(live);
  });
  it('the stored one once the answer ended, or when the live one missed its beginning (a window reloaded mid-answer)', () => {
    expect(liveOver(thread(answer({ status: 'complete', text: '읽은 쪽을 바탕으로' })), live)).toBeNull();
    expect(liveOver(thread(answer({ text: '앞서 받은 글 ' })), { ...live, text: '그 뒤의 글' })).toBeNull();
    expect(liveOver(thread(answer({ tools: [read(1), read(41, 42)] })), live)).toBeNull();
    expect(liveOver(thread(answer()), null)).toBeNull();
  });
});
