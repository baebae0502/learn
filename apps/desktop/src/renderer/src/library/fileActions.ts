import type { Result, WindowState } from '@learn/domain';
import { unwrap } from '../api';
import { t } from '../strings';
import type { ToastData } from '../ui/toasts';

/** The file actions whose first run can make a long copy in main (spec 8). */
export type FileActionKind = 'open' | 'reveal' | 'export';
/** Under 300 ms nothing shows; past it, the work says so (design-spec 6). */
export const FILE_BUSY_DELAY_MS = 300;

export interface BusyToastDeps {
  show(data: ToastData): string;
  close(key: string): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

/** "여는 중…" / "내보내는 중…", then the file name on one line; kind busy: no close button, no time-out. */
export const busyToast = (kind: FileActionKind, fileName: string): ToastData => ({
  kind: 'busy',
  title: t.toast.busy[kind],
  ...(fileName ? { lines: [fileName] } : {}),
  testId: 'file-busy',
});

export type RunFileAction = <T>(kind: FileActionKind, fileName: string, call: () => Promise<Result<T>>, opts?: { countFrom?: Promise<void> }) => Promise<T>;

/**
 * Runs a file call and resolves with its data (an ApiError when main refused). While the call is still pending
 * FILE_BUSY_DELAY_MS after `countFrom` (default: at once), a busy toast says what is being made; it goes when the call
 * settles. `countFrom` is for a call that first waits on the user (사본 내보내기's save panel): that time is not work.
 */
export function fileActionRunner(deps: BusyToastDeps): RunFileAction {
  return async function runFileAction<T>(kind: FileActionKind, fileName: string, call: () => Promise<Result<T>>, opts: { countFrom?: Promise<void> } = {}): Promise<T> {
    let settled = false;
    let timer: unknown = null;
    let key: string | null = null;
    const arm = () => {
      if (settled) return;
      timer = deps.setTimer(() => {
        timer = null;
        if (!settled) key = deps.show(busyToast(kind, fileName));
      }, FILE_BUSY_DELAY_MS);
    };
    if (opts.countFrom) void opts.countFrom.then(arm);
    else arm();
    try {
      return await unwrap(call());
    } finally {
      settled = true;
      if (timer !== null) deps.clearTimer(timer);
      if (key !== null) deps.close(key);
    }
  };
}

/**
 * Resolves `closed` when the window's sheet goes after it came (windowState: sheetOpen true, then false) — how the
 * renderer learns that main's save panel has closed (main marks it as a sheet). `stop` unsubscribes.
 */
export function whenPanelCloses(subscribe: (cb: (state: Pick<WindowState, 'sheetOpen'>) => void) => () => void): { closed: Promise<void>; stop(): void } {
  let seen = false;
  let resolve: () => void = () => {};
  const closed = new Promise<void>((r) => (resolve = r));
  const stop = subscribe((state) => {
    if (state.sheetOpen) seen = true;
    else if (seen) {
      resolve();
      stop();
    }
  });
  return { closed, stop };
}
