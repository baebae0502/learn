import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterEditing, editSession, flushEdits, leaveEditing, openEditSession, type EditSession } from './editGuard';

const closers: Array<() => void> = [];
const open = (over: Partial<EditSession> = {}): EditSession => {
  const s: EditSession = { itemId: 'a', dirty: () => true, leave: vi.fn(async () => true), ...over };
  closers.push(openEditSession(s));
  return s;
};
/** Where main's executeJavaScript finds the flush (M/edit-flush.ts FLUSH_SCRIPT): the page's global. */
const host = globalThis as { __learnFlushEdits?: () => Promise<string> };
afterEach(() => {
  while (closers.length > 0) closers.pop()!();
});

describe('leaving an open edit (spec §5.3)', () => {
  it('lets anything go on at once while nothing is being edited', async () => {
    const run = vi.fn();
    afterEditing(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await leaveEditing()).toBe(true);
  });
  it('goes on only once the editor let go (nothing changed, or saved); never while it stays', async () => {
    const s = open();
    const run = vi.fn();
    afterEditing(run);
    expect(run).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(s.leave).toHaveBeenCalledTimes(1);
    closers.pop()!();
    open({ leave: vi.fn(async () => false) });
    const stays = vi.fn();
    afterEditing(stays);
    await new Promise((r) => setTimeout(r, 0));
    expect(stays).not.toHaveBeenCalled();
  });
  it('asks once for callers that come together (the first click of a double-click, then the double-click)', async () => {
    let release!: (ok: boolean) => void;
    const s = open({ leave: vi.fn(() => new Promise<boolean>((r) => (release = r))) });
    const a = leaveEditing();
    const b = leaveEditing();
    expect(s.leave).toHaveBeenCalledTimes(1);
    release(true);
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    const later = leaveEditing();
    expect(s.leave).toHaveBeenCalledTimes(2); // a later attempt asks again
    release(true);
    await later; // left pending it would hold the shared answer for the next test
  });
  it('a closer closes only its own session', () => {
    const first = openEditSession({ itemId: 'a', dirty: () => false, leave: async () => true });
    const second = open({ itemId: 'b' });
    first();
    expect(editSession()).toBe(second);
  });
  it('answers main before a close or a quit — clean, saved or invalid — through a hook that exists only while an editor is open', async () => {
    expect(host.__learnFlushEdits).toBeUndefined();
    expect(await flushEdits()).toBe('clean');
    open({ dirty: () => false });
    expect(host.__learnFlushEdits).toBe(flushEdits);
    expect(await host.__learnFlushEdits!()).toBe('clean');
    closers.pop()!();
    expect(host.__learnFlushEdits).toBeUndefined();
    open({ dirty: () => true });
    expect(await flushEdits()).toBe('saved');
    closers.pop()!();
    open({ dirty: () => true, leave: vi.fn(async () => false) }); // a marked field: the form stays and says why
    expect(await flushEdits()).toBe('invalid');
  });
});
