// Opening the ⌘/ sheet and the settings window, timed in main (perf.evidence.ts; T13M-n4, critique mac2 m3).
import path from 'node:path';
import { expect, type ElectronApplication } from '@playwright/test';
import { expectWindow, launch, type LaunchOptions } from '../e2e/helpers';

/**
 * Times menu command → window shown in a session (both main-process clocks: t0 when the menu item is clicked in main,
 * shown at the window's 'show'). Also used to compare the cold first open with an older build. A window already there
 * and hidden (the prepared settings window) counts from its 'show'.
 */
export async function openTimer(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => {
    const g = globalThis as { __learnOpen?: { t0: number; shown?: number } };
    const watch = (win: InstanceType<typeof BrowserWindow>) =>
      win.on('show', () => {
        if (g.__learnOpen && g.__learnOpen.shown === undefined) g.__learnOpen.shown = Date.now();
      });
    // The settings window main prepared hidden is shown by the first ⌘,, not made: timed by its own 'show'.
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.isVisible()) watch(win);
    app.on('browser-window-created', (_event, win) => watch(win));
  });
  const click = (id: string) =>
    app.evaluate(({ BrowserWindow, Menu }, id) => {
      (globalThis as { __learnOpen?: { t0: number } }).__learnOpen = { t0: Date.now() };
      Menu.getApplicationMenu()!.getMenuItemById(id)!.click(undefined, BrowserWindow.getFocusedWindow() ?? undefined);
    }, id);
  const elapsed = async () => {
    await expect.poll(() => app.evaluate(() => (globalThis as { __learnOpen?: { shown?: number } }).__learnOpen?.shown ?? 0)).toBeGreaterThan(0);
    return app.evaluate(() => {
      const o = (globalThis as { __learnOpen?: { t0: number; shown?: number } }).__learnOpen!;
      return o.shown! - o.t0;
    });
  };
  return { click, elapsed };
}

/**
 * The first ⌘/ sheet or the first settings window of a new app session, `sessions` times (each a fresh launch, which returns
 * with the settings window prepared, the window opened 1 s later): what the demo's viewer meets the first time (critique mac2 m3: 1.20 s and
 * 0.87 s in the run 2 video, against repeat medians of 292 and 197 ms).
 */
export async function coldFirstOpens(dir: string, sessions: number, opts: LaunchOptions = {}): Promise<{ sheet: number[]; settings: number[] }> {
  const out = { sheet: [] as number[], settings: [] as number[] };
  for (const [kind, id] of [['sheet', 'app.shortcuts'], ['settings', 'app.settings']] as const) {
    for (let i = 0; i < sessions; i++) {
      const s = await launch(path.join(dir, `${kind}-${i}`, 'library'), path.join(dir, `${kind}-${i}`, 'userdata'), opts);
      try {
        const t = await openTimer(s.app);
        await s.page.waitForTimeout(1000);
        await expectWindow(s.app, kind, () => t.click(id));
        out[kind].push(await t.elapsed());
      } finally {
        await s.app.close();
      }
    }
  }
  return out;
}

