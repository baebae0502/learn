import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobKind } from './lane';
import { QUIT_STOP_MS, createQuitGuard, quitQuestion, type QuitGuardDeps, type QuitQuestion } from './quit-guard';

afterEach(() => {
  vi.useRealTimers();
});

function quitEvent() {
  const e = {
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
  };
  return e;
}
/** A lane running `kind` until stop(). */
function fakeLane(kind: JobKind | null) {
  let busy = kind;
  let stopped!: () => void;
  const idle = new Promise<void>((r) => {
    stopped = r;
  });
  return {
    busy: () => busy,
    cancelAll: vi.fn(),
    idle: () => (busy === null ? Promise.resolve() : idle),
    stop() {
      busy = null;
      stopped();
    },
  };
}
function guard(lane: ReturnType<typeof fakeLane>, over: Partial<QuitGuardDeps<'main'>> & { answer?: boolean | Promise<boolean> } = {}) {
  const asked: Array<{ owner: 'main' | null; question: QuitQuestion }> = [];
  const quit = vi.fn();
  const onStay = vi.fn();
  const { answer, ...deps } = over;
  const g = createQuitGuard<'main'>({
    lane,
    remaining: () => 3,
    owner: () => 'main',
    ask: async (owner, question) => {
      asked.push({ owner, question });
      return await (answer ?? true);
    },
    quit,
    onStay,
    ...deps,
  });
  return { g, asked, quit, onStay };
}
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('quitting while the work line runs (spec 3.6, P-19)', () => {
  it('lets the quit through untouched when nothing runs: the edit-flush gate is next', () => {
    const h = guard(fakeLane(null));
    const e = quitEvent();
    expect(h.g.onBeforeQuit(e)).toBe(false);
    expect(e.prevented).toBe(false);
    expect(h.asked).toEqual([]);
  });

  it('asks first while it imports, naming the files that will not come in; 취소 keeps the app and the import', async () => {
    const lane = fakeLane('import');
    const h = guard(lane, { answer: false });
    const e = quitEvent();
    expect(h.g.onBeforeQuit(e)).toBe(true);
    expect(e.prevented).toBe(true);
    await flush();
    expect(h.asked).toEqual([{
      owner: 'main',
      question: { type: 'warning', message: '가져오는 중입니다', detail: '끝내면 남은 3개는 가져오지 않습니다.', buttons: ['끝내기', '취소'], defaultId: 0, cancelId: 1 },
    }]);
    expect(lane.cancelAll).not.toHaveBeenCalled();
    expect(h.quit).not.toHaveBeenCalled();
    expect(h.onStay).toHaveBeenCalledTimes(1);
    // 취소 was for that quit only: the next one asks again.
    expect(h.g.onBeforeQuit(quitEvent())).toBe(true);
    await flush();
    expect(h.asked).toHaveLength(2);
  });

  it('끝내기 stops the work, waits for it to stop, then quits', async () => {
    const lane = fakeLane('import');
    const h = guard(lane);
    h.g.onBeforeQuit(quitEvent());
    await flush();
    expect(lane.cancelAll).toHaveBeenCalledTimes(1);
    expect(h.quit).not.toHaveBeenCalled(); // still stopping
    lane.stop();
    await flush();
    expect(h.quit).toHaveBeenCalledTimes(1);
    expect(h.onStay).not.toHaveBeenCalled();
  });

  it('waits at most 10 s for the work to stop, then quits anyway; that quit passes though the work still runs', async () => {
    vi.useFakeTimers();
    const lane = fakeLane('import');
    const h = guard(lane);
    h.g.onBeforeQuit(quitEvent());
    await vi.advanceTimersByTimeAsync(QUIT_STOP_MS - 1);
    expect(h.quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.quit).toHaveBeenCalledTimes(1);
    const repeat = quitEvent();
    expect(h.g.onBeforeQuit(repeat)).toBe(false);
    expect(repeat.prevented).toBe(false);
    expect(h.asked).toHaveLength(1);
  });

  it('the pass ends: a quit the next gate called off does not wave a later one through', async () => {
    vi.useFakeTimers();
    const lane = fakeLane('import');
    const h = guard(lane, { passMs: 5000 });
    h.g.onBeforeQuit(quitEvent());
    await vi.advanceTimersByTimeAsync(QUIT_STOP_MS);
    expect(h.quit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.g.onBeforeQuit(quitEvent())).toBe(true); // still running: asked again
  });

  it('a second quit while it asks or stops is held, never asked twice', async () => {
    const lane = fakeLane('import');
    let say!: (v: boolean) => void;
    const h = guard(lane, { answer: new Promise<boolean>((r) => { say = r; }) });
    h.g.onBeforeQuit(quitEvent());
    const second = quitEvent();
    expect(h.g.onBeforeQuit(second)).toBe(true);
    expect(second.prevented).toBe(true);
    await flush();
    expect(h.asked).toHaveLength(1);
    say(true);
    await flush();
    expect(h.g.onBeforeQuit(quitEvent())).toBe(true); // stopping now
    lane.stop();
    await flush();
    expect(h.quit).toHaveBeenCalledTimes(1);
    expect(h.asked).toHaveLength(1);
  });

  it('an import with every file done is only finishing: waited for, not asked about, nothing cancelled', async () => {
    const lane = fakeLane('import');
    const h = guard(lane, { remaining: () => 0 });
    h.g.onBeforeQuit(quitEvent());
    await flush();
    expect(h.asked).toEqual([]);
    expect(lane.cancelAll).not.toHaveBeenCalled();
    lane.stop();
    await flush();
    expect(h.quit).toHaveBeenCalledTimes(1);
  });

  it('with no main window it asks without one', async () => {
    const h = guard(fakeLane('backup'), { owner: () => null, answer: false });
    h.g.onBeforeQuit(quitEvent());
    await flush();
    expect(h.asked[0]!.owner).toBe(null);
    expect(h.onStay).toHaveBeenCalledTimes(1);
  });

  it('a question that cannot be shown does not keep the app: the work is stopped and it quits', async () => {
    const lane = fakeLane('import');
    const h = guard(lane, { ask: async () => { throw new Error('no dialog'); } });
    h.g.onBeforeQuit(quitEvent());
    await flush();
    expect(lane.cancelAll).toHaveBeenCalledTimes(1);
    lane.stop();
    await flush();
    expect(h.quit).toHaveBeenCalledTimes(1);
  });

  it('names a backup and a restore in their own words, 끝내기 first and the default', () => {
    expect(quitQuestion('backup', 0)).toEqual({ type: 'warning', message: '백업을 만드는 중입니다', detail: '끝내면 만들던 백업은 남지 않습니다.', buttons: ['끝내기', '취소'], defaultId: 0, cancelId: 1 });
    expect(quitQuestion('restore', 0)).toMatchObject({ message: '복원하는 중입니다', detail: '끝내면 만들던 라이브러리는 남지 않습니다.' });
  });
});
