import type { PreventableEvent } from '../edit-flush';
import { mainStrings } from '../strings';
import type { JobKind, JobLane } from './lane';

/** How long a confirmed quit waits for the work to stop; past it the app quits anyway (the next check shows what was left). */
export const QUIT_STOP_MS = 10_000;
/**
 * How long the confirmed quit's own repeats pass unasked: the edit-flush gate after this one asks the page (up to its
 * 3 s) and quits again. A pass still set after this belongs to a quit that did not happen.
 */
export const QUIT_GUARD_PASS_MS = 5_000;

export interface QuitQuestion {
  type: 'warning';
  message: string;
  detail: string;
  buttons: [string, string];
  defaultId: 0;
  cancelId: 1;
}

/** 끝내기 first and the default (the user asked to quit); 취소 keeps the app. */
export function quitQuestion(kind: JobKind, remaining: number): QuitQuestion {
  const words = mainStrings.quitGuard;
  const what = kind === 'import' ? { message: words.import.message, detail: words.import.detail(remaining) } : words[kind];
  return { type: 'warning', message: what.message, detail: what.detail, buttons: [words.quit, mainStrings.confirmSheet.cancel], defaultId: 0, cancelId: 1 };
}

export interface QuitGuardDeps<W> {
  lane: Pick<JobLane, 'busy' | 'cancelAll' | 'idle'>;
  /** Files of the import run not finished yet, the one under way included. */
  remaining(): number;
  /** The main window, for the question to hang on; null when there is none. */
  owner(): W | null;
  /** Shows the question; true for 끝내기. */
  ask(owner: W | null, question: QuitQuestion): Promise<boolean>;
  /** app.quit(): the quit again, once the work has stopped. */
  quit(): void;
  /** 취소 was chosen and the app stays. */
  onStay?(): void;
  stopMs?: number;
  passMs?: number;
}

export interface QuitGuard {
  /** The app's before-quit, ahead of the edit-flush gate: true when it took this quit (called off for now). */
  onBeforeQuit(event: PreventableEvent): boolean;
}

/**
 * Quitting while an import, backup or restore runs (spec 3.6): a native question first; 끝내기 stops the work as 취소
 * does, waits for it (at most QUIT_STOP_MS) and quits again, which then goes through the edit-flush gate.
 */
export function createQuitGuard<W>(deps: QuitGuardDeps<W>): QuitGuard {
  let holding = false;
  let passing = false;
  let passTimer: ReturnType<typeof setTimeout> | undefined;

  const quitNow = (): void => {
    passing = true;
    clearTimeout(passTimer);
    passTimer = setTimeout(() => {
      passing = false;
    }, deps.passMs ?? QUIT_GUARD_PASS_MS);
    passTimer.unref?.();
    deps.quit();
  };
  const stopped = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, deps.stopMs ?? QUIT_STOP_MS);
      void deps.lane.idle().then(() => {
        clearTimeout(timer);
        resolve();
      });
    });

  async function hold(kind: JobKind): Promise<void> {
    const remaining = kind === 'import' ? deps.remaining() : 0;
    // An import with every file done is only finishing (filing, its last notices): waited for, not asked about.
    if (kind !== 'import' || remaining > 0) {
      let leave: boolean;
      try {
        leave = await deps.ask(deps.owner(), quitQuestion(kind, remaining));
      } catch {
        leave = true; // no question could be shown: the quit the user asked for goes ahead, safely stopped
      }
      if (!leave) {
        deps.onStay?.();
        return;
      }
      deps.lane.cancelAll();
    }
    await stopped();
    quitNow();
  }

  return {
    onBeforeQuit(event) {
      if (passing) return false;
      if (holding) {
        event.preventDefault(); // a second ⌘Q while asking or stopping
        return true;
      }
      const kind = deps.lane.busy();
      if (kind === null) return false;
      event.preventDefault();
      holding = true;
      void hold(kind).finally(() => {
        holding = false;
      });
      return true;
    },
  };
}
