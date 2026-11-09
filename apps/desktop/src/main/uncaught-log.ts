/**
 * E2E only: an uncaught exception in main opens Electron's error box (gtk_dialog_run), which nobody dismisses under Xvfb,
 * so main hangs without a trace. The monitor only watches (it changes nothing about how the exception is handled); it
 * puts the error and its stack on stderr as one line first. Production registers nothing.
 */
export interface UncaughtSource {
  on(event: 'uncaughtExceptionMonitor', listener: (error: unknown) => void): unknown;
}

export function registerUncaughtLog(e2e: boolean, proc: UncaughtSource, write: (line: string) => void): boolean {
  if (!e2e) return false;
  proc.on('uncaughtExceptionMonitor', (error) => {
    const text = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
    write(`[main] uncaught: ${text.replace(/\r?\n/g, ' | ')}\n`);
  });
  return true;
}
