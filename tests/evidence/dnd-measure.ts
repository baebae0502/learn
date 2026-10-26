// Measuring helpers for the M5 Task 1 drag-and-drop spike (branch m5-spike only): page open, real mouse drags
// (Playwright intercepts Chromium drags, so dragstart, RAC's handlers and dragend are the browser's own), the report.
// Budgets are the plan's; Linux is judged at 2x, as in M4.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { Bridge } from '../../apps/desktop/src/renderer/src/spike/bridge';
import { ROOT } from '../e2e/helpers';
import { IS_MAC, writeJson } from './capture';

export const BUDGET = { treeMount: 50, expandAll: 50, overP95: 4, dropToHandler: 16, dragStart: 16 } as const;
export const limit = (ms: number): number => (IS_MAC ? ms : 2 * ms);

export type CheckId = 'R1' | 'R2' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'P1';
export interface Check {
  ok: boolean;
  /** `native`, `workaround: …`, `record`, `skipped: …`, `error`. */
  how: string;
  value: unknown;
}

export function createReport(file: string, description: string) {
  const checks: Partial<Record<CheckId, Check>> = {};
  const check = (id: CheckId, ok: boolean, how: string, value: unknown): void => void (checks[id] = { ok, how, value });
  return {
    check,
    async guard(id: CheckId, run: () => Promise<void>): Promise<void> {
      try {
        await run();
      } catch (e) {
        check(id, false, 'error', { error: String(e).slice(0, 1200) });
      }
    },
    save(): void {
      const failed = Object.entries(checks).flatMap(([id, c]) => (c.ok ? [] : [id]));
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/desktop/package.json'), 'utf8')) as { devDependencies: Record<string, string> };
      writeJson(
        file,
        {
          rac: pkg.devDependencies['react-aria-components'], tanstack: pkg.devDependencies['@tanstack/react-virtual'] ?? null,
          platform: `${process.platform}-${process.arch}`, ci: process.env['CI'] ?? null, budgetsMs: BUDGET,
          limitsMs: Object.fromEntries(Object.entries(BUDGET).map(([k, v]) => [k, limit(v)])), checks, verdict: { ok: failed.length === 0, failed },
        },
        description,
      );
      console.log('[dnd-spike] verdict', JSON.stringify({ failed }));
    },
  };
}
export type Report = ReturnType<typeof createReport>;

export const r1 = (x: number): number => Math.round(x * 10) / 10;
export const pct = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
};
export const stats = (xs: readonly number[]) => ({ n: xs.length, p50: r1(pct(xs, 50)), p95: r1(pct(xs, 95)), max: r1(Math.max(...xs)) });

export const frames = (page: Page, n = 2): Promise<void> =>
  page.evaluate((count) => new Promise<void>((resolve) => {
    let left = count;
    const tick = () => (--left <= 0 ? resolve() : void requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);

/** A fresh page (new document: new rows, empty bridge), once the first row is on screen. */
export async function openSpike(page: Page, query = ''): Promise<void> {
  await page.goto(`learn://app/index.html?window=spike&platform=${process.platform}${query}`);
  await expect(page.locator('[data-testid="item-row"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('coll-c000')).toBeVisible();
  await frames(page, 3);
}

/** Reads the bridge in the page. */
export const br = <T>(page: Page, fn: (b: Bridge) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__dnd)`) as Promise<T>;
export const api = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([n, a]) => (window.__dnd!.api as Record<string, (...x: unknown[]) => unknown>)[n as string]!(...(a as unknown[])) as never, [name, args] as const) as Promise<T>;

export const tableRow = (page: Page, index: number): Locator => page.locator(`[data-testid="item-row"][data-index="${index}"]`);
export const treeRow = (page: Page, id: string): Locator => page.getByTestId(`coll-${id}`);

const centre = async (loc: Locator, fx = 0.5, fy = 0.5, dx = 0): Promise<{ x: number; y: number }> => {
  const b = (await loc.boundingBox())!;
  return { x: b.x + Math.min(b.width * fx, 140) + dx, y: b.y + b.height * fy };
};

/** Presses on `loc`'s label area and moves a little: the browser starts the drag (dragstart) after the first moves. */
export async function beginDrag(page: Page, loc: Locator): Promise<void> {
  const p = await centre(loc, 0.5, 0.5, 0);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 8, p.y + 5, { steps: 3 });
  await expect.poll(() => br(page, (b) => b.dragging)).toBe(true);
  await frames(page, 2);
}
/** Moves the held pointer over `loc` (fx, fy: fraction of its box) and lets two frames pass. */
export async function hover(page: Page, loc: Locator, fy = 0.5, steps = 8): Promise<void> {
  const p = await centre(loc, 0.5, fy);
  await page.mouse.move(p.x, p.y, { steps });
  // Chromium hands the page a dragover only now and then while the pointer moves: a few 1 px moves settle the last one.
  for (let i = 1; i <= 3; i++) {
    await frames(page, 1);
    await page.mouse.move(p.x + i, p.y);
  }
  await frames(page, 2);
}
export async function release(page: Page): Promise<void> {
  await page.mouse.up();
  await frames(page, 3);
  await page.waitForTimeout(80);
}
/** Cancels a drag the way a user does (esc), then lets the mouse go. */
export async function cancelDrag(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await frames(page, 2);
  await page.mouse.up();
  await frames(page, 3);
  await page.waitForTimeout(80);
}
export const marked = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('[data-drop-target]')].map((e) => e.getAttribute('data-testid') ?? e.getAttribute('data-item-id') ?? e.className));
