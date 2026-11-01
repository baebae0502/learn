import { describe, expect, it, vi } from 'vitest';
import { IDLE_IMPORT_STATE, type ImportQueueState, type ImportReport, type Result } from '@learn/domain';
import type { ProgressToast } from '../jobs/progressToast';
import type { ToastData } from '../ui/toasts';
import { IMPORT_CALL_PATHS, createImportRunner, inImportCalls, type ImportRunnerDeps } from './importRunner';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const running = (over: Partial<ImportQueueState> = {}): ImportQueueState => ({ ...IDLE_IMPORT_STATE, state: 'running', total: 2, ...over });
const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  imported: 0, filed: 0, filedExisting: 0, failed: [], openItemId: null, requested: 2, cancelled: false, mode: 'managed', collectionId: null, untouched: 0, ...over,
});

function harness(over: Partial<ImportRunnerDeps> = {}) {
  const log: string[] = [];
  const toasts: ToastData[] = [];
  let sending = 0;
  let settling = 0;
  let cancels = 0;
  let askedHere = 0;
  const toast: ProgressToast = {
    begin: vi.fn((quiet: boolean) => void log.push(`begin:${quiet}`)),
    end: vi.fn(() => {
      log.push('end');
      return 'k1';
    }),
    settle: vi.fn((key: string | null, result: ToastData | null) => void log.push(`settle:${key}:${result?.title ?? 'none'}`)),
  };
  const deps: ImportRunnerDeps = {
    importPaths: vi.fn(async (input) => ok({ queued: input.paths.length })),
    pickAndImport: vi.fn(async () => ok({ queued: 2 })),
    sending: (d) => void (sending += d),
    settling: (d) => void (settling += d),
    setQuiet: vi.fn(),
    setPanel: vi.fn((open: boolean) => void log.push(`panel:${open}`)),
    showToast: (data) => void toasts.push(data),
    refreshList: vi.fn(async () => void log.push('list')),
    screenSettled: vi.fn(async () => void log.push('screen')),
    collectionName: (id) => (id === 'c1' ? '학회 준비' : null),
    cancelCount: () => cancels,
    askedHere: () => askedHere,
    takeQuiet: () => false,
    toast,
    mark: (name) => void log.push(`mark:${name}`),
    clearMarks: vi.fn(),
    ...over,
  };
  return { runner: createImportRunner(deps), deps, log, toasts, toast, cancel: () => void (cancels += 1), cancelHere: () => void (askedHere += 1), sending: () => sending, settling: () => settling };
}

describe('a drop goes into the queue (P-2)', () => {
  it('in calls of at most 500 paths, one after another, in order, each with the mode and the collection', async () => {
    expect(IMPORT_CALL_PATHS).toBe(500);
    expect(inImportCalls(Array.from({ length: 1201 }, (_, i) => i)).map((c) => c.length)).toEqual([500, 500, 201]);
    const h = harness();
    const paths = Array.from({ length: 1201 }, (_, i) => `/in/${i}.pdf`);
    await h.runner.drop(paths, 'linked', { id: 'c1', name: '학회 준비' }, Promise.resolve());
    const calls = vi.mocked(h.deps.importPaths).mock.calls.map(([input]) => [input.paths.length, input.paths[0], input.mode, input.collectionId]);
    expect(calls).toEqual([[500, '/in/0.pdf', 'linked', 'c1'], [500, '/in/500.pdf', 'linked', 'c1'], [201, '/in/1000.pdf', 'linked', 'c1']]);
    expect(h.sending()).toBe(0);
    expect(h.log.filter((l) => l.startsWith('mark:'))).toEqual(['mark:import:start', 'mark:import:sent', 'mark:import:answered']);
  });
  it('counts the files it hands over until main has answered for them, and waits for the overlay-less frame before sending', async () => {
    let ready!: () => void;
    const h = harness();
    const done = h.runner.drop(['/in/a.pdf', '/in/b.pdf'], 'managed', null, new Promise<void>((r) => (ready = r)));
    await Promise.resolve();
    expect(h.sending()).toBe(2);
    expect(h.deps.importPaths).not.toHaveBeenCalled();
    ready();
    await done;
    expect(vi.mocked(h.deps.importPaths).mock.calls[0]![0]).toEqual({ paths: ['/in/a.pdf', '/in/b.pdf'], mode: 'managed' });
    expect(h.sending()).toBe(0);
  });
  it('취소 pressed here between two chunks ends the rest at once, before main has reported it', async () => {
    const h = harness();
    vi.mocked(h.deps.importPaths).mockImplementationOnce(async (input) => {
      h.cancelHere();
      return ok({ queued: input.paths.length });
    });
    await h.runner.drop(Array.from({ length: 1200 }, (_, i) => `/in/${i}.pdf`), 'managed', null, Promise.resolve());
    expect(h.deps.importPaths).toHaveBeenCalledTimes(1);
    expect(h.sending()).toBe(0);
  });
  it('a 취소 only main counted (menu, palette) ends the rest as well: no second run, nothing counted as still being handed over', async () => {
    const h = harness();
    vi.mocked(h.deps.importPaths).mockImplementationOnce(async (input) => {
      h.cancel();
      return ok({ queued: input.paths.length });
    });
    await h.runner.drop(Array.from({ length: 1200 }, (_, i) => `/in/${i}.pdf`), 'managed', null, Promise.resolve());
    expect(h.deps.importPaths).toHaveBeenCalledTimes(1);
    expect(h.sending()).toBe(0);
  });
  it('a refused call is the import-failures toast with main\'s words, and nothing is left counted', async () => {
    const h = harness({ importPaths: vi.fn(async () => ({ ok: false, code: 'VALIDATION_FAILED', message: '잘못된 요청입니다.', retryable: false }) as Result<{ queued: number }>) });
    await h.runner.drop(Array.from({ length: 600 }, (_, i) => `/in/${i}.pdf`), 'managed', null, Promise.resolve());
    expect(h.toasts).toEqual([{ kind: 'error', title: '가져오지 못했습니다', body: '잘못된 요청입니다.', testId: 'import-failures' }]);
    expect(h.sending()).toBe(0);
    expect(h.deps.importPaths).toHaveBeenCalledTimes(1);
  });
});

describe('파일 가져오기…: the open panel holds the window while it is up', () => {
  it('the panel flag goes up and down around the call; a cancelled panel says nothing', async () => {
    const h = harness({ pickAndImport: vi.fn(async () => ok({ queued: 0 })) });
    await h.runner.pick('managed', { id: 'c1', name: '학회 준비' });
    expect(vi.mocked(h.deps.pickAndImport).mock.calls[0]![0]).toEqual({ mode: 'managed', collectionId: 'c1' });
    expect(h.log.filter((l) => l.startsWith('panel:'))).toEqual(['panel:true', 'panel:false']);
    expect(h.toasts).toEqual([]);
    expect(h.deps.clearMarks).toHaveBeenCalledWith(false);
  });
  it('a refused call is the import-failures toast, and the panel flag still goes down', async () => {
    const h = harness({ pickAndImport: vi.fn(async () => ({ ok: false, code: 'LIBRARY_UNAVAILABLE', message: '라이브러리를 열 수 없습니다.', retryable: false }) as Result<{ queued: number }>) });
    await h.runner.pick('linked', null);
    expect(h.toasts.map((t) => t.testId)).toEqual(['import-failures']);
    expect(h.log.at(-1)).toBe('panel:false');
  });
});

describe('a run as this window shows it (spec 3.3)', () => {
  it('begins once with its first busy notice; at its end the list is read before the result takes the toast over', async () => {
    const h = harness();
    h.runner.progress(running({ done: 0 }));
    h.runner.progress(running({ done: 1 }));
    h.runner.progress({ ...IDLE_IMPORT_STATE }); // the idle notice changes nothing
    expect(h.toast.begin).toHaveBeenCalledTimes(1);
    await h.runner.finished(report({ imported: 2 }));
    expect(h.log).toEqual(['begin:false', 'end', 'list', 'mark:import:listed', 'screen', 'settle:k1:자료 2개를 가져왔습니다', 'mark:import:end']);
    expect(h.toast.end).toHaveBeenCalledWith(running({ done: 1 }));
    expect(h.settling()).toBe(0);
  });
  it('names the run\'s collection from the organize model; one it no longer finds is not named', async () => {
    const h = harness();
    h.runner.progress(running());
    await h.runner.finished(report({ imported: 2, filed: 2, collectionId: 'c1' }));
    h.runner.progress(running());
    await h.runner.finished(report({ imported: 2, filed: 2, collectionId: 'gone' }));
    expect(vi.mocked(h.toast.settle).mock.calls.map(([, r]) => r?.title)).toEqual(['‘학회 준비’⁠에 자료 2개를 가져왔습니다', '자료 2개를 가져왔습니다']);
  });
  it('failures are a toast of their own; nothing imported reads no list', async () => {
    const h = harness();
    h.runner.progress(running());
    await h.runner.finished(report({ failed: [{ name: 'notes.txt', message: '지원하지 않는 형식입니다.' }] }));
    expect(h.deps.refreshList).not.toHaveBeenCalled();
    expect(h.toasts).toEqual([{ kind: 'error', title: '파일 1개를 가져오지 못했습니다', lines: [{ name: 'notes.txt', cause: '지원하지 않는 형식입니다.' }], testId: 'import-failures' }]);
    expect(vi.mocked(h.toast.settle).mock.calls[0]).toEqual(['k1', null]);
  });
  it('a quiet run (the E2E setup) has no toast, no busy screen and no wait for one, but its list is read', async () => {
    const h = harness({ takeQuiet: () => true });
    h.runner.progress(running());
    expect(h.deps.setQuiet).toHaveBeenCalledWith(true);
    await h.runner.finished(report({ imported: 2, failed: [{ name: 'x.txt', message: 'x' }] }));
    expect(h.log).toEqual(['begin:true', 'end', 'list', 'mark:import:listed', 'settle:k1:none', 'mark:import:end']);
    expect(h.toasts).toEqual([]);
    expect(h.deps.setQuiet).toHaveBeenLastCalledWith(false);
  });
  it('a run that was over before main\'s first notice (the notices are throttled) is a run all the same: its quiet flag is taken at its end', async () => {
    const quiet = harness({ takeQuiet: () => true });
    await quiet.runner.finished(report({ imported: 1, requested: 1 }));
    expect(quiet.deps.setQuiet).toHaveBeenCalledWith(true);
    expect(quiet.deps.setQuiet).toHaveBeenLastCalledWith(false);
    expect(quiet.toasts).toEqual([]);
    expect(vi.mocked(quiet.toast.settle).mock.calls).toEqual([[ 'k1', null ]]);
    const loud = harness();
    await loud.runner.finished(report({ imported: 1, requested: 1 }));
    expect(vi.mocked(loud.toast.settle).mock.calls[0]![1]?.title).toBe('자료 1개를 가져왔습니다');
  });
  it('a run that begins while the last one\'s end is shown is a run of its own', async () => {
    let list!: () => void;
    const h = harness({ refreshList: () => new Promise<void>((r) => (list = r)) });
    h.runner.progress(running());
    const first = h.runner.finished(report({ imported: 2 }));
    h.runner.progress(running({ total: 1 }));
    expect(h.toast.begin).toHaveBeenCalledTimes(2);
    expect(h.settling()).toBe(1);
    list();
    await first;
    // Each run set its own flag as it began; the first run's end leaves the new run's alone (no third call).
    expect(vi.mocked(h.deps.setQuiet).mock.calls).toEqual([[false], [false]]);
    expect(h.settling()).toBe(0);
  });
});
