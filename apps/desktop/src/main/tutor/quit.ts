import { errorCode, tutorLog } from './log';
import type { TutorService } from './service';

export interface QuitEvent {
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

const logFailure = (e: unknown): void => tutorLog('quit-shutdown-failed', { code: errorCode(e) });

/**
 * The tutor at quit: a quit that goes ahead stops the agent first — its answer cancelled, at most `maxMs`, then SIGKILL —
 * so the database closes after it, and then quits again. With no agent the quit goes on at once, the tutor shut all the
 * same, so a start still waiting for detection cannot spawn during it. A quit another gate called off is left alone.
 * Registered as the last before-quit handler. A shutdown that fails leaves its code in the log, and the quit goes on:
 * will-quit kills whatever is left of the agent's group.
 */
export function createTutorQuitGate(d: { tutor(): Pick<TutorService, 'processes' | 'shutdown'> | null; quit(): void; maxMs: number }): { onBeforeQuit(event: QuitEvent): void } {
  let stopping = false;
  let shut = false;
  return {
    onBeforeQuit(event) {
      if (event.defaultPrevented || shut) return;
      const tutor = d.tutor();
      if (tutor === null) return;
      if (!stopping && tutor.processes().count === 0) {
        shut = true;
        void tutor.shutdown(d.maxMs).catch(logFailure);
        return;
      }
      event.preventDefault();
      if (stopping) return;
      stopping = true;
      void tutor.shutdown(d.maxMs).catch(logFailure).finally(() => {
        shut = true;
        d.quit();
      });
    },
  };
}
