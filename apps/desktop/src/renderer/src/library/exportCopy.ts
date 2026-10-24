import { ApiError } from '../api';
import { t } from '../strings';
import type { ToastData } from '../ui/toasts';

export interface ExportCopyDeps {
  /** The save panel is up (a sheet that holds the window) or gone. */
  setPanel(open: boolean): void;
  /** Resolves `closed` when the panel has closed (the windowState push); `stop` unsubscribes. */
  watchPanel(): { closed: Promise<void>; stop(): void };
  /** The call, behind the busy toast (its second line: `fileName`); the toast's clock starts when the panel has closed. */
  run(itemId: string, fileName: string, countFrom: Promise<void>): Promise<{ saved: boolean }>;
  /** The file name the copy will have, for the busy toast's second line. */
  fileName(itemId: string): string;
  /** The saved toast's action: its label (the platform's words for showing a file in its folder) and what it does. */
  revealLabel: string;
  reveal(): void;
  show(data: ToastData): void;
  log(e: unknown): void;
}

/**
 * 사본 내보내기…, one at a time. Main remembers a single last copy (the one the toast's link reveals) and the window is
 * held while the panel is up, so a second export can only start from a path that skips the held window (a shortcut that
 * fired late, a double click on the menu). It is ignored: a second run would overwrite the first's remembered copy and
 * the first's end would clear the panel flag under the second's open panel.
 */
export function createExportCopy(deps: ExportCopyDeps): (itemId: string) => Promise<void> {
  let running = false;
  return async function exportCopy(itemId: string): Promise<void> {
    if (running) return;
    running = true;
    deps.setPanel(true);
    // The panel is part of the call: the busy toast counts from its close.
    const panel = deps.watchPanel();
    void panel.closed.then(() => deps.setPanel(false));
    try {
      const { saved } = await deps.run(itemId, deps.fileName(itemId), panel.closed);
      if (saved)
        deps.show({
          kind: 'success',
          title: t.toast.exportSaved,
          testId: 'export-done',
          action: { label: deps.revealLabel, testId: 'export-reveal', onAction: deps.reveal },
        });
    } catch (e) {
      // Main's refusal carries its Korean cause and next step; anything else (the channel itself failed) has only English.
      if (!(e instanceof ApiError)) deps.log(e);
      deps.show({ kind: 'error', title: t.toast.exportFailed, body: e instanceof ApiError ? e.message : t.toast.exportFailedBody, testId: 'export-failed' });
    } finally {
      panel.stop();
      deps.setPanel(false);
      running = false;
    }
  };
}
