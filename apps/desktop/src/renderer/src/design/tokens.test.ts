import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { composite, contrast, parseColor, type Rgba } from './color';
import {
  colors,
  colorsContrastMore,
  density,
  layout,
  space,
  tagColors,
  typeScale,
  type ColorToken,
  type ThemePair,
} from './tokens';

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];

/** Base surfaces text can sit on. Translucent fills are composited onto each of these. */
const SURFACES = ['bgWindow', 'bgSidebar', 'bgContent', 'bgContentAlt', 'bgRaised'] as const satisfies readonly ColorToken[];

function palette(theme: Theme, overrides: Partial<Record<ColorToken, ThemePair>> = {}) {
  return (key: ColorToken): Rgba => parseColor((overrides[key] ?? colors[key])[theme]);
}

function on(c: (k: ColorToken) => Rgba, fill: ColorToken, base: ColorToken): Rgba {
  const f = c(fill);
  return f.a < 1 ? composite(f, c(base)) : f;
}

/** Translucent layers composited bottom-up onto `base` (a control on a card on a surface). */
function onLayers(c: (k: ColorToken) => Rgba, fills: readonly ColorToken[], base: ColorToken): Rgba {
  return fills.reduce((under, fill) => {
    const f = c(fill);
    return f.a < 1 ? composite(f, under) : f;
  }, c(base));
}

function expectContrast(label: string, fg: Rgba, bg: Rgba, min: number) {
  const ratio = contrast(fg, bg);
  expect(ratio, `${label}: ${ratio.toFixed(2)} < ${min}`).toBeGreaterThanOrEqual(min);
}

describe('colour tokens', () => {
  it('stay inside the sRGB gamut', () => {
    for (const [key, p] of Object.entries({ ...colors, ...colorsContrastMore })) {
      for (const theme of THEMES) expect(parseColor(p[theme]).clamped, `${key}.${theme}`).toBe(false);
    }
  });

  for (const theme of THEMES) {
    for (const [mode, overrides] of [
      ['default', {}],
      ['prefers-contrast: more', colorsContrastMore],
    ] as const) {
      describe(`${theme} (${mode})`, () => {
        const c = palette(theme, overrides);

        it('body text (primary, secondary) ≥ 4.5:1 on every surface, hover and neutral selection', () => {
          for (const text of ['textPrimary', 'textSecondary'] as const) {
            for (const s of SURFACES) {
              expectContrast(`${text}/${s}`, c(text), c(s), 4.5);
              for (const fill of ['fillHover', 'fillSelected', 'bgField', 'bgControl'] as const) {
                expectContrast(`${text}/${fill}@${s}`, c(text), on(c, fill, s), 4.5);
              }
            }
          }
        });

        it('controls on a card (a sheet\'s keycaps and file thumb: bgControl over fillHover): text ≥ 4.5:1, icons ≥ 3:1', () => {
          for (const s of SURFACES) {
            const nested = onLayers(c, ['fillHover', 'bgControl'], s);
            expectContrast(`textPrimary/bgControl@fillHover@${s}`, c('textPrimary'), nested, 4.5);
            // Secondary is only an icon colour there (the thumb glyph): 4.16:1 in dark on bgRaised, under 4.5, which is
            // why the shortcut sheet's keycaps use primary text (screens/sheet.css).
            expectContrast(`textSecondary icon/bgControl@fillHover@${s}`, c('textSecondary'), nested, 3);
          }
        });

        it('tertiary text and icons ≥ 3:1 on base surfaces (non-essential text only)', () => {
          for (const s of SURFACES) expectContrast(`textTertiary/${s}`, c('textTertiary'), c(s), 3);
        });

        it('accent and semantic text ≥ 4.5:1 on content surfaces and the window', () => {
          for (const text of ['accentText', 'dangerText', 'warningText', 'successText'] as const) {
            for (const s of ['bgWindow', 'bgContent', 'bgRaised', 'bgSidebar'] as const) {
              expectContrast(`${text}/${s}`, c(text), c(s), 4.5);
            }
          }
          expectContrast('accentText/accentSoft', c('accentText'), on(c, 'accentSoft', 'bgContent'), 4.5);
          expectContrast('textPrimary/accentSoft', c('textPrimary'), on(c, 'accentSoft', 'bgContent'), 4.5);
        });

        it('focused selection and primary buttons: label ≥ 4.5:1 on accent fills', () => {
          for (const fill of ['accent', 'accentHover', 'accentPressed'] as const) {
            expectContrast(`textOnAccent/${fill}`, c('textOnAccent'), c(fill), 4.5);
          }
        });

        it('meter fills (progress, spinner, scrubber) ≥ 3:1 against the track on every surface', () => {
          for (const s of SURFACES) expectContrast(`meter/track@${s}`, c('meter'), on(c, 'bgTrack', s), 3);
        });

        it('focus ring and strong borders ≥ 3:1 against the surfaces they sit on', () => {
          for (const s of SURFACES) {
            expectContrast(`focus/${s}`, c('focus'), c(s), 3);
            expectContrast(`borderStrong/${s}`, c('borderStrong'), c(s), 3);
          }
        });
      });
    }
  }

  it('in high-contrast mode separators and borders reach 3:1', () => {
    for (const theme of THEMES) {
      const c = palette(theme, colorsContrastMore);
      for (const s of SURFACES) {
        expectContrast(`${theme} separator/${s}`, c('separator'), c(s), 3);
        expectContrast(`${theme} border/${s}`, c('border'), c(s), 3);
      }
    }
  });

  it('dark mode puts content below the chrome and raised surfaces above it', () => {
    const L = (key: ColorToken) => Number(/oklch\(([\d.]+)%/.exec(colors[key].dark)![1]);
    expect(L('bgContent')).toBeLessThan(L('bgSidebar'));
    expect(L('bgSidebar')).toBeLessThan(L('bgWindow'));
    expect(L('bgWindow')).toBeLessThan(L('bgRaised'));
  });
});

describe('scale tokens', () => {
  it('tag colours are eight unique positions 1–8', () => {
    expect(tagColors.map((t) => t.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(tagColors.map((t) => t.hex)).size).toBe(8);
  });

  it('spacing, row heights and bars sit on the 4 px grid (2 and 6 are the only half steps)', () => {
    for (const s of space) expect(s % 4 === 0 || s === 2 || s === 6, `space ${s}`).toBe(true);
    for (const h of Object.values(density)) expect(h % 4, `row ${h}`).toBe(0);
    for (const key of ['toolbarHeight', 'paneHeaderHeight', 'tableHeaderHeight', 'controlHeight', 'sidebarWidth', 'inspectorWidth'] as const) {
      expect(layout[key] % 4, key).toBe(0);
    }
  });

  it('type scale: line heights on the 2 px half-grid, Korean UI weights ≤ 600', () => {
    for (const [role, t] of Object.entries(typeScale)) {
      expect(t.line % 2, role).toBe(0);
      expect(t.line).toBeGreaterThan(t.size);
      expect(t.weight, role).toBeLessThanOrEqual(600);
    }
    expect(typeScale.body).toEqual({ size: 13, line: 18, weight: 400 });
  });
});

describe('generated files', () => {
  it('tokens.css and tokens.generated.ts match tokens.ts (run `pnpm tokens`)', () => {
    const script = path.resolve(import.meta.dirname, '../../../../scripts/build-tokens.mjs');
    expect(() =>
      execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', script, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
