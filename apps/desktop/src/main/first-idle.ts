import { errorCode } from './error-code';

/** What one step of the first idle came to: 'ok', or the code it threw (errorCode). */
export type FirstIdleStep = 'ok' | string;

/** The main window's first idle as main handled it (E2E's textState shows it). */
export interface FirstIdleReport {
  /** Epoch ms. */
  at: number;
  /** The automatic check sheet may follow. */
  screen: FirstIdleStep;
  /** The body-text scheduler's first idle. */
  text: FirstIdleStep;
  /** The settings window, prepared hidden. */
  settings: FirstIdleStep;
  /** The ⌘/ sheet's window, prepared hidden. */
  sheets: FirstIdleStep;
}

export interface FirstIdleSteps {
  screen(): void;
  text(): void;
  settings(): void;
  sheets(): void;
}

/**
 * ui.reportIdle: the main window drew its first list and went idle. The two signals others wait for (the automatic check
 * sheet, the body-text scheduler) go first, and each step runs whatever the one before it threw: a window that fails to be
 * prepared must not keep the index from ever starting, nor the other window from being prepared. A throw is logged as its
 * code only.
 */
export function runFirstIdle(steps: FirstIdleSteps, log: (line: string) => void = (line) => console.error(line)): FirstIdleReport {
  const run = (what: string, step: () => void): FirstIdleStep => {
    try {
      step();
      return 'ok';
    } catch (e) {
      const code = errorCode(e);
      log(`[window] first idle: ${what} failed: ${code}`);
      return code;
    }
  };
  const screen = run('screen', steps.screen);
  const text = run('text', steps.text);
  const settings = run('settings', steps.settings);
  const sheets = run('sheets', steps.sheets);
  return { at: Date.now(), screen, text, settings, sheets };
}
