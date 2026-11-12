import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({ translation: { cancel: async () => ({ ok: true, data: undefined }) } }) }));

const { createTutorTabStore, draftKey, forgetTutorTab, ringedChip } = await import('./tutorStore');
const { useTutorRun } = await import('./tutorRun');
const { createReaderScope } = await import('../viewers/readerScope');

describe('the tutor store of one reader tab', () => {
  it('starts on a new empty session', () => {
    expect(createTutorTabStore().getState()).toMatchObject({ conversationId: null });
  });
  it('keeps the session this tab shows apart from every other tab\'s', () => {
    const a = createTutorTabStore();
    const b = createTutorTabStore();
    const id = '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11';
    a.getState().setConversation(id);
    expect(a.getState().conversationId).toBe(id);
    expect(b.getState().conversationId).toBeNull();
    b.getState().setConversation(null);
    expect(a.getState().conversationId).toBe(id);
    a.getState().setConversation(null);
    expect(a.getState().conversationId).toBeNull();
  });
  it('holds nothing but the tab\'s own fields', () => {
    expect(Object.keys(createTutorTabStore().getState()).sort()).toEqual([
      'choosing', 'conversationId', 'currentCite', 'drafts', 'live', 'setChoosing', 'setConversation', 'setCurrentCite', 'setDraft', 'setLive', 'setWaiting', 'waiting',
    ]);
  });
  it('another session drops the live answer of the one before; the same one keeps it', () => {
    const a = createTutorTabStore();
    const live = { tutorMessageId: 'm', text: '답', tools: [], running: null, verifiedSoFar: new Set<number>() };
    a.getState().setConversation('3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11');
    a.getState().setLive(live);
    a.getState().setConversation('3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11');
    expect(a.getState().live).toBe(live);
    a.getState().setCurrentCite({ key: 'm:0', pageIndex: 41, revisionId: 'r1', shown: true });
    a.getState().setConversation(null);
    expect(a.getState().live).toBeNull();
    expect(a.getState().currentCite).toBeNull(); // the chip it named is not on screen any more
  });
  it('keeps the session a tab shows for a reload of the window (this window\'s storage), and forgets it when the tab closes', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) });
    try {
      const id = '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11';
      createTutorTabStore('item-a').getState().setConversation(id);
      expect(createTutorTabStore('item-a').getState().conversationId).toBe(id); // the window reloaded
      expect(createTutorTabStore('item-b').getState().conversationId).toBeNull();
      expect(createTutorTabStore().getState().conversationId).toBeNull(); // no tab: nothing kept
      forgetTutorTab('item-a');
      expect(createTutorTabStore('item-a').getState().conversationId).toBeNull();
      const b = createTutorTabStore('item-b');
      b.getState().setConversation(id);
      b.getState().setConversation(null);
      expect(createTutorTabStore('item-b').getState().conversationId).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('keeps 에이전트 고르기… apart per tab', () => {
    const a = createTutorTabStore();
    const b = createTutorTabStore();
    expect(a.getState().choosing).toBe(false);
    a.getState().setChoosing(true);
    expect(a.getState().choosing).toBe(true);
    expect(b.getState().choosing).toBe(false);
  });
  it('is one of the reader scope\'s stores: a document\'s tab has its own', () => {
    const x = createReaderScope('x');
    const y = createReaderScope('y');
    x.tutor.getState().setConversation('3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11');
    expect(y.tutor.getState().conversationId).toBeNull();
    expect(x.tutor).not.toBe(y.tutor);
  });
});

describe('drafts and the question that waits for another session\'s answer', () => {
  const A = '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11';
  const B = '9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d';
  it('keeps a draft per session of the tab, the new empty session under its item, while the tab is open', () => {
    expect(draftKey(A, 'item-a')).toBe(A);
    expect(draftKey(null, 'item-a')).toBe('new:item-a');
    const a = createTutorTabStore('item-a');
    a.getState().setDraft(draftKey(null, 'item-a'), '처음 질문');
    a.getState().setConversation(A);
    expect(a.getState().drafts[draftKey(A, 'item-a')]).toBeUndefined();
    a.getState().setDraft(A, '이어서 묻기');
    a.getState().setConversation(null);
    // Back on either session, its own draft is there.
    expect(a.getState().drafts).toEqual({ 'new:item-a': '처음 질문', [A]: '이어서 묻기' });
    // Another tab has its own.
    expect(createTutorTabStore('item-b').getState().drafts).toEqual({});
    // An emptied draft is no draft.
    a.getState().setDraft(A, '');
    expect(a.getState().drafts).toEqual({ 'new:item-a': '처음 질문' });
  });
  it('is memory only: a store made again for the same tab (a reload, a new run) starts without drafts', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) });
    try {
      const a = createTutorTabStore('item-a');
      a.getState().setConversation(A);
      a.getState().setDraft(A, '쓰던 글');
      const again = createTutorTabStore('item-a');
      expect(again.getState().conversationId).toBe(A); // the session is kept for a reload (positive control) ...
      expect(again.getState().drafts).toEqual({}); // ... the draft is not
      expect([...kept.values()].join()).not.toContain('쓰던 글');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('holds the question that waits for another session\'s answer until it is sent or let go; another session lets it go', () => {
    const a = createTutorTabStore();
    expect(a.getState().waiting).toBeNull();
    const waiting = { text: '다음 질문', busyWith: { conversationId: A, messageId: B } };
    a.getState().setWaiting(waiting);
    expect(a.getState().waiting).toBe(waiting);
    a.getState().setConversation(null); // the same (new empty) session: it still waits
    expect(a.getState().waiting).toBe(waiting);
    a.getState().setWaiting(null);
    expect(a.getState().waiting).toBeNull();
    a.getState().setWaiting(waiting);
    a.getState().setConversation(B);
    expect(a.getState().waiting).toBeNull();
  });
});

describe('the chip the reader was sent to', () => {
  it('is ringed while the tab shows the revision it sent the reader to, and not in another revision', () => {
    const current = { key: 'm:1', pageIndex: 41, revisionId: 'r1', shown: true };
    expect(ringedChip(current, 'r1')).toBe('m:1');
    expect(ringedChip(current, 'r2')).toBeNull();
    expect(ringedChip(current, null)).toBeNull(); // the tab's document not known yet
    expect(ringedChip({ ...current, revisionId: null }, 'r1')).toBeNull();
    expect(ringedChip(null, 'r1')).toBeNull();
  });
});

describe('나중에 is the run\'s (spec 8.2)', () => {
  it('is one value for every tab, off at the start, and holds nothing else', () => {
    expect(useTutorRun.getState().later).toBe(false);
    const x = createReaderScope('x');
    const y = createReaderScope('y');
    useTutorRun.getState().setLater(true);
    expect(useTutorRun.getState().later).toBe(true);
    expect(Object.keys(x.tutor.getState())).not.toContain('later');
    expect(Object.keys(y.tutor.getState())).not.toContain('later');
    useTutorRun.getState().setLater(false);
    expect(useTutorRun.getState().later).toBe(false);
  });
});
