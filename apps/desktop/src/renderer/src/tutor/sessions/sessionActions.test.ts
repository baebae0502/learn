import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary } from '@learn/domain';

const calls = vi.hoisted(() => ({ rename: [] as Array<() => void>, deleted: [] as string[], settings: [] as Array<[string, unknown]> }));
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  api: () => ({
    sessions: {
      // Each rename answers when the test lets it.
      rename: (input: { conversationId: string; title: string | null }) =>
        new Promise((resolve) => calls.rename.push(() => resolve({ ok: true, data: { ...SESSION, id: input.conversationId, title: input.title ?? SESSION.title, renamed: input.title !== null } }))),
      delete: async ({ conversationId }: { conversationId: string }) => {
        calls.deleted.push(conversationId);
        return { ok: true, data: undefined };
      },
      restore: async () => ({ ok: true, data: undefined }),
    },
    settings: {
      set: async (input: { key: string; value: unknown }) => {
        calls.settings.push([input.key, input.value]);
        return { ok: true, data: undefined };
      },
    },
  }),
}));
vi.mock('../../ui/toasts', () => ({ showToast: vi.fn(() => 'k'), showUndoToast: vi.fn(() => 'k') }));

const SESSION: SessionSummary = { id: 'a', itemId: 'item', title: '어텐션이 뭐야?', renamed: false, agent: 'fake', mixedAgents: false, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' };
const { chooseTutorMode, deleteSession, finishRename, openSessionWith } = await import('./sessionActions');
const { useSessionEdit } = await import('./sessionEdit');
const { createReaderScope } = await import('../../viewers/readerScope');
const { queryClient } = await import('../../data/query-client');
const { settingKey } = await import('../../data/saveSetting');

beforeEach(() => {
  calls.rename.length = 0;
  calls.deleted.length = 0;
  calls.settings.length = 0;
  useSessionEdit.setState({ renaming: null, text: '', busy: false, focusRow: null });
});

describe('the session actions\' late ends act on their own edit and focus only', () => {
  it('a rename that answers after another row\'s rename began leaves that one open', async () => {
    useSessionEdit.getState().begin('a');
    const done = finishRename(SESSION, '새 이름', 'enter');
    expect(useSessionEdit.getState().busy).toBe(true);
    useSessionEdit.getState().begin('b');
    calls.rename.shift()!();
    await done;
    expect(useSessionEdit.getState()).toMatchObject({ renaming: 'b', focusRow: null });
  });
  it('a rename that answers with its own edit still open ends it and gives the row the focus back', async () => {
    useSessionEdit.getState().begin('a');
    const done = finishRename(SESSION, '새 이름', 'enter');
    calls.rename.shift()!();
    await done;
    expect(useSessionEdit.getState()).toMatchObject({ renaming: null, focusRow: 'a' });
  });
  it('a delete hands the focus to the next row only while the focus is still where the delete left it', async () => {
    await deleteSession('a', { id: 'n', stillHere: () => false });
    expect(useSessionEdit.getState().focusRow).toBeNull();
    await deleteSession('b', { id: 'n', stillHere: () => true });
    expect(useSessionEdit.getState().focusRow).toBe('n');
    expect(calls.deleted).toEqual(['a', 'b']);
  });
});

describe('a library row\'s open: all of it behind the edit check', () => {
  const setup = (accepted: boolean) => {
    const scope = createReaderScope('item');
    const d = { afterEditing: vi.fn((run: () => void) => accepted && run()), scope: vi.fn(() => scope), openTab: vi.fn(), showTutor: vi.fn() };
    openSessionWith(d)('item', 'a');
    return { d, scope };
  };
  it('a refused edit leaves nothing behind: no scope, no tab, no mode, no reveal', () => {
    const { d, scope } = setup(false);
    expect(d.afterEditing).toHaveBeenCalledTimes(1);
    expect([d.scope, d.openTab, d.showTutor].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
    expect(scope.tutor.getState().conversationId).toBeNull();
  });
  it('an accepted one opens the tab on that session with the tutor shown', () => {
    const { d, scope } = setup(true);
    expect(scope.tutor.getState().conversationId).toBe('a');
    expect(d.openTab).toHaveBeenCalledExactlyOnceWith('item');
    expect(d.showTutor).toHaveBeenCalledTimes(1);
    expect(d.openTab.mock.invocationCallOrder[0]).toBeLessThan(d.showTutor.mock.invocationCallOrder[0]!);
  });
});

describe('choosing 튜터 mode writes the setting only when it is not already 튜터', () => {
  it('a reader on 정보 is switched (one write); one on 튜터 — or not chosen yet, which reads as 튜터 — is not written again', () => {
    queryClient.setQueryData(settingKey('reader.inspectorMode'), 'info');
    chooseTutorMode();
    expect(queryClient.getQueryData(settingKey('reader.inspectorMode'))).toBe('tutor');
    chooseTutorMode();
    queryClient.setQueryData(settingKey('reader.inspectorMode'), undefined);
    chooseTutorMode();
    expect(calls.settings).toEqual([['reader.inspectorMode', 'tutor']]);
  });
});
