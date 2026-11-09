import { describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { BODY_READ_GAP_MS, ECHO_WAIT_MS, IMPORT_READ_GAP_MS, NARROW_LIMIT, createChangeHandler, type ChangeDeps } from './libraryChange';

const item = (id: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  id, title: id, type: 'pdf', mime: 'application/pdf', size: 1, storageMode: 'managed', availability: 'available', assetId: `a-${id}`, revisionId: `r-${id}`,
  originalName: `${id}.pdf`, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', creators: [], year: null, publisher: null,
  progress: null, openedAt: null, ...over,
});
const LIST = [item('a'), item('b'), item('c')];

function setup(over: { list?: LibraryItem[] | undefined; refetching?: boolean; fresh?: (ids: string[]) => Promise<LibraryItem[]> } = {}) {
  const calls = { all: 0, organize: 0, trash: 0, texts: 0, detail: [] as string[], body: 0, items: [] as string[], put: [] as (readonly LibraryItem[])[], getItems: [] as string[][] };
  let list: readonly LibraryItem[] | undefined = 'list' in over ? over.list : LIST;
  // A clock, timers and idle callbacks that the test runs by hand.
  const clock = { t: 0 };
  const timers = new Map<number, { at: number; fn: () => void }>();
  const idles = new Map<number, () => void>();
  let nextId = 1;
  const deps: ChangeDeps = {
    cached: () => list,
    refetching: () => over.refetching ?? false,
    put: (_prev, next) => {
      list = next;
      calls.put.push(next);
    },
    getItems: (ids) => {
      calls.getItems.push(ids);
      return (over.fresh ?? (async (want) => want.map((id) => item(id))))(ids);
    },
    invalidateAll: () => void (calls.all += 1),
    invalidateOrganize: () => void (calls.organize += 1),
    invalidateTrash: () => void (calls.trash += 1),
    invalidateItem: (id) => void calls.items.push(id),
    invalidateTexts: () => void (calls.texts += 1),
    invalidateDetail: (id) => void calls.detail.push(id),
    invalidateBody: () => void (calls.body += 1),
    whenIdle: (fn) => {
      const id = nextId++;
      idles.set(id, fn);
      return () => void idles.delete(id);
    },
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock.t + ms, fn });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
    now: () => clock.t,
  };
  const changes = createChangeHandler(deps);
  const time = {
    /** Moves the clock on and fires the timers that fell due, in order. */
    advance(ms: number) {
      clock.t += ms;
      for (const [id, tm] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (tm.at <= clock.t && timers.delete(id)) tm.fn();
      }
    },
    /** The window goes idle: every waiting idle callback runs. */
    idle() {
      for (const [id, fn] of [...idles]) {
        idles.delete(id);
        fn();
      }
    },
    idling: () => idles.size,
    timing: () => timers.size,
  };
  return { handle: changes.onChange, changes, time, calls, list: () => list };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('the library list after a change notice (spec 10.3)', () => {
  it('a text notice reads each item\'s detail and the body search again, and nothing else', async () => {
    const { handle, calls, time } = setup();
    handle({ reason: 'text', itemIds: ['a', 'b', 'a'] });
    await settle();
    expect(calls).toMatchObject({ detail: ['a', 'b'], body: 0, all: 0, organize: 0, trash: 0, texts: 0, items: [], getItems: [], put: [] });
    time.advance(BODY_READ_GAP_MS);
    expect(calls).toMatchObject({ detail: ['a', 'b'], body: 1, all: 0 });
    handle({ reason: 'text' });
    time.advance(BODY_READ_GAP_MS);
    expect(calls).toMatchObject({ detail: ['a', 'b'], body: 2, all: 0 });
  });

  it('a run of text notices reads the body search once, a second after the first', () => {
    const { handle, calls, time } = setup();
    for (let k = 0; k < 6; k++) {
      handle({ reason: 'text', itemIds: [`i${k}`] });
      time.advance(100);
    }
    expect(calls.body).toBe(0);
    expect(calls.detail).toHaveLength(6); // each panel still updates at once
    time.advance(BODY_READ_GAP_MS);
    expect(calls.body).toBe(1);
  });

  it('an import, trash, restore and purge notice read the body search again as well as the list', async () => {
    for (const reason of ['import', 'trash', 'restore', 'purge'] as const) {
      const { handle, calls, time } = setup();
      handle({ reason, itemIds: ['a'] });
      time.idle();
      await settle();
      expect(calls, reason).toMatchObject({ all: 1, body: 1 });
    }
    const { handle, calls } = setup();
    handle({ reason: 'metadata', itemIds: ['a'] });
    await settle();
    expect(calls.body).toBe(0); // positive control: the others are not all that read it
  });

  it('collections and tags read only the organize snapshot, whatever items they name; collections the trash view too', async () => {
    const { handle, calls } = setup();
    handle({ reason: 'tags', itemIds: ['a'] });
    handle({ reason: 'collections' });
    await settle();
    expect(calls).toMatchObject({ organize: 2, trash: 1, all: 0, getItems: [], put: [] });
  });

  it('a position notice reads those items only, like an opened one', async () => {
    const read = item('b', { progress: 0.37 });
    const { handle, calls, list } = setup({ fresh: async () => [read] });
    handle({ reason: 'position', itemIds: ['b'] });
    await settle();
    expect(calls.getItems).toEqual([['b']]);
    expect(calls.all).toBe(0);
    expect(list()![1]).toBe(read);
  });

  it('an opened notice reads those items only and patches them into the list, in place', async () => {
    const opened = item('b', { openedAt: '2026-10-25T00:00:00.000Z' });
    const { handle, calls, list } = setup({ fresh: async () => [opened] });
    handle({ reason: 'opened', itemIds: ['b'] });
    await settle();
    expect(calls.getItems).toEqual([['b']]);
    expect(calls.all).toBe(0);
    expect(calls.items).toEqual(['b']);
    expect(calls.texts).toBe(0); // the searched fields did not change
    expect(list()!.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(list()![1]).toBe(opened);
    expect(list()![0]).toBe(LIST[0]); // the other rows keep their identity, so they do not redraw
  });

  it('relink, availability and metadata are narrowed too; only metadata makes the search texts stale', async () => {
    for (const reason of ['relink', 'availability', 'metadata'] as const) {
      const { handle, calls } = setup({ fresh: async () => [item('a', { title: '새 제목' })] });
      handle({ reason, itemIds: ['a'] });
      await settle();
      expect(calls.all, reason).toBe(0);
      expect(calls.getItems, reason).toEqual([['a']]);
      expect(calls.texts, reason).toBe(reason === 'metadata' ? 1 : 0);
      expect(calls.organize, reason).toBe(reason === 'relink' ? 1 : 0); // a relinked file can move the duplicate groups
    }
  });

  it('reads the whole list for import, trash, restore and purge, and when no ids came or more than 500', async () => {
    const many = Array.from({ length: NARROW_LIMIT + 1 }, (_, k) => `x${k}`);
    for (const change of [
      { reason: 'trash' as const, itemIds: ['a'] }, { reason: 'restore' as const, itemIds: ['a'] },
      { reason: 'purge' as const, itemIds: ['a'] }, { reason: 'purge' as const },
      { reason: 'metadata' as const }, { reason: 'opened' as const, itemIds: [] }, { reason: 'metadata' as const, itemIds: many },
    ]) {
      const { handle, calls } = setup();
      handle(change);
      await settle();
      expect(calls.all, JSON.stringify(change).slice(0, 60)).toBe(1);
      expect(calls.getItems).toEqual([]);
    }
    const exactly = Array.from({ length: NARROW_LIMIT }, (_, k) => `x${k}`);
    const { handle, calls } = setup({ fresh: async () => [] });
    handle({ reason: 'metadata', itemIds: exactly });
    expect(calls.getItems[0]).toHaveLength(NARROW_LIMIT); // 500 is still narrow
  });

  it('reads the whole list when there is none cached yet, or a read of it is already running', async () => {
    const none = setup({ list: undefined });
    none.handle({ reason: 'opened', itemIds: ['a'] });
    const busy = setup({ refetching: true });
    busy.handle({ reason: 'opened', itemIds: ['a'] });
    await settle();
    expect(none.calls.all).toBe(1);
    expect(busy.calls.all).toBe(1);
    expect(none.calls.getItems.concat(busy.calls.getItems)).toEqual([]);
  });

  it('falls back to the whole list when an item is gone, when the list has no such row, or when the read fails', async () => {
    const gone = setup({ fresh: async () => [] });
    gone.handle({ reason: 'metadata', itemIds: ['a'] });
    const unknown = setup({ fresh: async () => [item('zzz')] });
    unknown.handle({ reason: 'metadata', itemIds: ['zzz'] });
    const failing = setup({ fresh: () => Promise.reject(new Error('x')) });
    failing.handle({ reason: 'opened', itemIds: ['a'] });
    await settle();
    for (const s of [gone, unknown, failing]) {
      expect(s.calls.all).toBe(1);
      expect(s.calls.put).toEqual([]);
    }
  });

  it('puts nothing when the item came back the way the list has it', async () => {
    const { handle, calls } = setup({ fresh: async () => [item('a')] });
    handle({ reason: 'availability', itemIds: ['a'] });
    await settle();
    expect(calls.put).toEqual([]);
    expect(calls.all).toBe(0);
  });

  it('drops a patch that a whole-list read overtook', async () => {
    let release: (items: LibraryItem[]) => void = () => {};
    const { handle, calls } = setup({ fresh: () => new Promise<LibraryItem[]>((r) => (release = r)) });
    handle({ reason: 'opened', itemIds: ['a'] });
    handle({ reason: 'trash', itemIds: ['d'] }); // the whole list is read again meanwhile
    release([item('a', { openedAt: '2026-10-25T00:00:00.000Z' })]);
    await settle();
    expect(calls.all).toBe(1);
    expect(calls.put).toEqual([]);
  });

  it('asks once for a repeated id', async () => {
    const getItems = vi.fn(async (ids: string[]) => ids.map((id) => item(id)));
    const { handle } = setup({ fresh: getItems });
    handle({ reason: 'opened', itemIds: ['a', 'a', 'b'] });
    expect(getItems).toHaveBeenCalledWith(['a', 'b']);
  });
});

describe('import notices read the whole list at most once a second, when idle (P10)', () => {
  it('five notices within 300 ms read nothing until idle, then once; a later one reads again; finishing flushes the wait', () => {
    const { handle, changes, calls, time } = setup();
    for (let k = 0; k < 5; k++) {
      handle({ reason: 'import', itemIds: [`n${k}`] });
      time.advance(60);
    }
    expect(calls.all).toBe(0);
    expect(time.idling()).toBe(1); // one read waits for idle, not five
    time.idle();
    expect(calls).toMatchObject({ all: 1, body: 1 });
    time.advance(IMPORT_READ_GAP_MS + 100);
    handle({ reason: 'import', itemIds: ['n6'] });
    time.idle();
    expect(calls.all).toBe(2);
    // a notice within the second of a read waits for the second to pass, then for idle
    handle({ reason: 'import', itemIds: ['n7'] });
    expect(time.idling()).toBe(0);
    expect(time.timing()).toBe(1);
    time.advance(IMPORT_READ_GAP_MS - 1);
    expect(time.idling()).toBe(0);
    time.advance(1);
    expect(time.idling()).toBe(1);
    time.idle();
    expect(calls.all).toBe(3);
    // the end of the run does not wait for either
    handle({ reason: 'import', itemIds: ['n8'] });
    changes.flushImports();
    expect(calls.all).toBe(4);
    expect(time.timing() + time.idling()).toBe(0);
    changes.flushImports(); // nothing waits: nothing is read
    expect(calls.all).toBe(4);
  });

  it('a read of everything for another reason takes over the one that was put off', () => {
    const { handle, calls, time } = setup();
    handle({ reason: 'import', itemIds: ['n1'] });
    handle({ reason: 'trash', itemIds: ['n1'] });
    expect(calls.all).toBe(1);
    time.idle();
    expect(calls.all).toBe(1);
  });
});

describe('a tag change this window made is not read again (P3)', () => {
  it('without an expectation the notice reads the snapshot; after one, a notice for those items does not, once', () => {
    const { handle, changes, calls } = setup();
    handle({ reason: 'tags', itemIds: ['a', 'b'] });
    expect(calls.organize).toBe(1); // positive control
    changes.expectEcho('tags', ['b', 'a']);
    handle({ reason: 'tags', itemIds: ['a', 'b'] });
    expect(calls.organize).toBe(1);
    handle({ reason: 'tags', itemIds: ['a', 'b'] });
    expect(calls.organize).toBe(2); // consumed by the first
    changes.expectEcho('tags', ['a', 'b']);
    handle({ reason: 'tags', itemIds: ['a', 'c'] });
    expect(calls.organize).toBe(3); // other items
    handle({ reason: 'tags' }); // a tag renamed or deleted names no items
    expect(calls.organize).toBe(4);
  });

  it('a notice for some of the items asked for is the echo too (the database names only those that changed)', () => {
    const { handle, changes, calls } = setup();
    changes.expectEcho('tags', ['a', 'b']);
    handle({ reason: 'tags', itemIds: ['b'] });
    expect(calls.organize).toBe(0);
  });

  it('an expectation that was cancelled (the call came back null, threw or changed nothing) swallows no later notice', () => {
    const { handle, changes, calls } = setup();
    const cancelKept = changes.expectEcho('tags', ['a']);
    handle({ reason: 'tags', itemIds: ['a'] });
    expect(calls.organize).toBe(0); // positive control: the expectation holds until cancelled
    cancelKept();
    const cancel = changes.expectEcho('tags', ['a']);
    cancel();
    handle({ reason: 'tags', itemIds: ['a'] });
    expect(calls.organize).toBe(1);
    cancel(); // twice is nothing
    changes.expectEcho('tags', ['a']);
    cancel(); // does not withdraw another entry
    handle({ reason: 'tags', itemIds: ['a'] });
    expect(calls.organize).toBe(1);
  });

  it('stops waiting after five seconds', () => {
    const { handle, changes, calls, time } = setup();
    changes.expectEcho('tags', ['a']);
    time.advance(ECHO_WAIT_MS);
    handle({ reason: 'tags', itemIds: ['a'] });
    expect(calls.organize).toBe(1);
  });
});

