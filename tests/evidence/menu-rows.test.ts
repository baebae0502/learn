import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMenuPanel, menuRows, rowsBelowFirstSeparator } from './menu-rows';
import { decodePng } from './png';

// Crop (x 190–410, y 20–130) of run 39631541294's m3-09-menu-view-click.screen.png: 보기 open with "사이드바 가리기
// ⌃⌘S", a separator, then two 전체 화면 rows (fn F, ⌃⌘F) — the duplicate the closed-menu System Events list missed.
const fixture = decodePng(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'view-menu-two-fullscreen-rows.png')));

describe('open-menu row counter (Task 8 R2-1)', () => {
  it('finds the panel from a seed in its top padding', () => {
    const panel = findMenuPanel(fixture, { x: 15, y: 10 });
    expect(panel.y0).toBe(5); // screen y 25: the panel's top below the menu bar
    expect(panel.y1).toBe(92); // screen y 112: its bottom edge
    expect(panel.x1 - panel.x0).toBeGreaterThan(150); // about 167 px across the top padding row
  });
  it('counts three text rows and one separator, so two full-screen rows', () => {
    const m = menuRows(fixture, findMenuPanel(fixture, { x: 15, y: 10 }));
    expect(m.rows).toHaveLength(3);
    expect(m.separators.length).toBeGreaterThanOrEqual(1);
    expect(rowsBelowFirstSeparator(m)).toBe(2);
  });
  it('counts one when the second full-screen row is painted over with the panel colour (the check can pass and fail)', () => {
    const one = { ...fixture, data: Uint8Array.from(fixture.data) };
    const bg = [...fixture.data.slice((10 * fixture.width + 15) * 4, (10 * fixture.width + 15) * 4 + 4)];
    for (let y = 66; y < 88; y++) for (let x = 12; x < 176; x++) one.data.set(bg, (y * one.width + x) * 4);
    expect(rowsBelowFirstSeparator(menuRows(one, findMenuPanel(one, { x: 15, y: 10 })))).toBe(1);
  });
});
