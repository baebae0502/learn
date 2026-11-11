import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({ translation: { cancel: async () => ({ ok: true, data: undefined }) } }) }));

const { createTutorTabStore } = await import('./tutorStore');
const { useTutorRun } = await import('./tutorRun');
const { createReaderScope } = await import('../viewers/readerScope');

describe('the tutor store of one reader tab (J44, J48)', () => {
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
  it('holds nothing but the tab\'s own fields: memory only', () => {
    expect(Object.keys(createTutorTabStore().getState()).sort()).toEqual(['choosing', 'conversationId', 'setChoosing', 'setConversation']);
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

describe('나중에 is the run\'s (R21, spec 8.2)', () => {
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
