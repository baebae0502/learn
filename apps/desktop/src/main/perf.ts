/**
 * Cold-start marks read by tests/evidence/perf.evidence.ts through app.evaluate (epoch ms; 0 = not reached yet).
 * processStart: when the main process started (performance.timeOrigin). ready: app 'ready'. firstPaint: the main
 * window's first 'ready-to-show' (its page has painted; the window code shows it then). windowShown: its first 'show'.
 * The renderer's own end mark is app-ready's data-at (MainWindow: the first render with a settled list, R-18).
 */
export const perf = { processStart: Math.round(performance.timeOrigin), ready: 0, firstPaint: 0, windowShown: 0 };
(globalThis as { __learnPerf?: typeof perf }).__learnPerf = perf;

/** The first time only: a main window opened again later (macOS Dock) leaves the cold-start marks alone. */
export function markPerf(name: 'ready' | 'firstPaint' | 'windowShown'): void {
  if (perf[name] === 0) perf[name] = Date.now();
}
