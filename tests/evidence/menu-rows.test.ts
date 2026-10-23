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
  it('counts a disabled item, whose grey text peaks about 61 from the panel (run 39779536146: 기본 글자 크기)', () => {
    // The second full-screen row redrawn as disabled: its ink lifted to 55 below the panel's brightness.
    const grey = { ...fixture, data: Uint8Array.from(fixture.data) };
    const bgAt = (10 * fixture.width + 15) * 4;
    const bg = fixture.data[bgAt]!;
    for (let y = 66; y < 88; y++) {
      for (let x = 12; x < 176; x++) {
        const i = (y * grey.width + x) * 4;
        if (bg - grey.data[i]! > 60) for (const c of [0, 1, 2]) grey.data[i + c] = bg - 55;
      }
    }
    expect(rowsBelowFirstSeparator(menuRows(grey, findMenuPanel(grey, { x: 15, y: 10 })))).toBe(2);
  });
  it('the measured extremes fall on their side of INK (re-review m6: separators ≤ 28, the disabled row ≥ 61)', () => {
    // A blank panel row redrawn as a 1 px line 28 below the panel (the faintest margin measured), and the second
    // full-screen row's text as grey 61 below it: still a separator and still a row.
    const edge = { ...fixture, data: Uint8Array.from(fixture.data) };
    const bg = fixture.data[(10 * fixture.width + 15) * 4]!;
    const panel = findMenuPanel(fixture, { x: 15, y: 10 });
    const before = menuRows(fixture, panel);
    for (let x = panel.x0; x < panel.x1; x++) for (const c of [0, 1, 2]) edge.data[(12 * edge.width + x) * 4 + c] = bg - 28;
    for (let y = 66; y < 88; y++) {
      for (let x = 12; x < 176; x++) {
        const i = (y * edge.width + x) * 4;
        if (bg - edge.data[i]! > 60) for (const c of [0, 1, 2]) edge.data[i + c] = bg - 61;
      }
    }
    const m = menuRows(edge, panel);
    expect(m.separators).toContain(panel.y0 + 7); // y 12 in the crop
    expect(m.rows).toHaveLength(before.rows.length);
    expect(rowsBelowFirstSeparator(m)).toBe(3); // the new line is now the first separator: all three rows below it
  });
});
