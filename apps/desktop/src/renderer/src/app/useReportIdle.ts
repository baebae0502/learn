import { useEffect } from 'react';
import { api } from '../api';
import { whenIdle } from '../ui/whenIdle';

/** At most this long after the first list, main hears it even from a page that never idles. */
export const IDLE_REPORT_TIMEOUT_MS = 2000;
/** Once per page: a remount (the fatal screen after a render failure) does not ask again. */
let reported = false;

/**
 * Tells main, once, that this main-window page has settled its first list (`ready`) and been idle: main then prepares
 * the settings window hidden, so ⌘, only shows it (spec 8) — never while the app is still starting.
 */
export function useReportIdle(ready: boolean): void {
  useEffect(() => {
    if (!ready || reported) return;
    return whenIdle(() => {
      reported = true;
      void api().ui.reportIdle().catch(() => {});
    }, IDLE_REPORT_TIMEOUT_MS);
  }, [ready]);
}
