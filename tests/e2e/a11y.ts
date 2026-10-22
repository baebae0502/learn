import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * axe (dev-only) on the current window: no serious or critical violations (AC18).
 * Legacy mode: Electron pages cannot open the blank page axe's cross-frame runner needs.
 * Two rules are off, and only these (Task 12 ruling):
 * - color-contrast: tokens.test.ts owns contrast in both themes and high contrast; tertiary text is 3:1 by design-spec
 *   3.1/8.3, and axe cannot compute text over the vibrancy material.
 * - video-caption: captions arrive in M8. Every other rule still runs on the <video>.
 */
export async function expectNoSeriousA11y(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).setLegacyMode(true).disableRules(['color-contrast', 'video-caption']).analyze();
  const serious = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious, `axe @ ${label}`).toEqual([]);
}
