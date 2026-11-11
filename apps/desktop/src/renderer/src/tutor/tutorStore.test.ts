import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({ translation: { cancel: async () => ({ ok: true, data: undefined }) } }) }));

const { createTutorTabStore } = await import('./tutorStore');
const { createReaderScope } = await import('../viewers/readerScope');

describe('the tutor store of one reader tab (J44, J48)', () => {
  it('starts on a new empty session, with the card not yet put off', () => {
    const store = createTutorTabStore();
    expect(store.getState()).toMatchObject({ conversationId: null, later: false });
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
  it('holds 나중에 in the store only: per tab, memory only, gone with the tab', () => {
    const a = createTutorTabStore();
    const b = createTutorTabStore();
    a.getState().setLater(true);
    expect(a.getState().later).toBe(true);
    expect(b.getState().later).toBe(false);
    a.getState().setLater(false);
    expect(a.getState().later).toBe(false);
    // Nothing is written anywhere: the store holds no more than its two fields and the setters.
    expect(Object.keys(a.getState()).sort()).toEqual(['conversationId', 'later', 'setConversation', 'setLater']);
  });
  it('is one of the reader scope\'s stores: a document\'s tab has its own', () => {
    const x = createReaderScope('x');
    const y = createReaderScope('y');
    x.tutor.getState().setLater(true);
    expect(y.tutor.getState().later).toBe(false);
    expect(x.tutor).not.toBe(y.tutor);
  });
});
