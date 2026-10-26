import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { t } from '../strings';
import type { ToastData } from '../ui/toasts';
import { createExportCopy, type ExportCopyDeps } from './exportCopy';

function setup(run: ExportCopyDeps['run']) {
  const shown: ToastData[] = [];
  const panel: boolean[] = [];
  const logged: unknown[] = [];
  const revealed: string[] = [];
  const stops: string[] = [];
  const deps: ExportCopyDeps = {
    setPanel: (open) => void panel.push(open),
    watchPanel: () => ({ closed: new Promise<void>(() => {}), stop: () => void stops.push('stop') }),
    run,
    fileName: (id) => `${id}.pdf`,
    revealLabel: 'Finder에서 보기',
    reveal: () => void revealed.push('reveal'),
    show: (data) => void shown.push(data),
    log: (e) => void logged.push(e),
  };
  return { exportCopy: createExportCopy(deps), shown, panel, logged, revealed, stops };
}
const later = <T,>() => {
  let done: (v: T) => void = () => {};
  let fail: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => ((done = res), (fail = rej)));
  return { promise, done, fail };
};

describe('one 사본 내보내기 at a time', () => {
  it('a second export while the first still runs is ignored: one call, one panel flag, one result', async () => {
    const first = later<{ saved: boolean }>();
    const run = vi.fn(() => first.promise);
    const s = setup(run as never);
    const a = s.exportCopy('a');
    await s.exportCopy('b'); // ignored: returns at once
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.panel).toEqual([true]);
    first.done({ saved: true });
    await a;
    expect(s.shown).toHaveLength(1);
    expect(s.panel).toEqual([true, false]);
    expect(s.stops).toEqual(['stop']);
  });

  it('after the first one ended (saved, cancelled or failed) the next one runs', async () => {
    const run = vi.fn(async () => ({ saved: false }));
    const s = setup(run as never);
    await s.exportCopy('a');
    await s.exportCopy('b');
    expect(run).toHaveBeenCalledTimes(2);
    const failing = setup((async () => Promise.reject(new ApiError('INTERNAL', 'x', false))) as never);
    await failing.exportCopy('a');
    await failing.exportCopy('b');
    expect(failing.shown).toHaveLength(2);
  });
});

describe('what an export that failed says', () => {
  it('main\'s refusal: its Korean cause and next step as the body', async () => {
    const s = setup((async () => Promise.reject(new ApiError('PERMISSION_DENIED', '이 폴더에는 쓸 수 없습니다.', true))) as never);
    await s.exportCopy('a');
    expect(s.shown).toEqual([{ kind: 'error', title: t.toast.exportFailed, body: '이 폴더에는 쓸 수 없습니다.', testId: 'export-failed' }]);
    expect(s.logged).toEqual([]);
  });

  it('a rejection that is not main\'s answer (the channel failed): the Korean body with a next step, the raw error logged', async () => {
    const raw = new Error("Error invoking remote method 'library:exportCopy': reply was never sent");
    const s = setup((async () => Promise.reject(raw)) as never);
    await s.exportCopy('a');
    expect(s.shown).toEqual([{ kind: 'error', title: t.toast.exportFailed, body: t.toast.exportFailedBody, testId: 'export-failed' }]);
    expect(s.logged).toEqual([raw]);
    expect(t.toast.exportFailedBody).not.toMatch(/[A-Za-z]{4}/);
  });
});
