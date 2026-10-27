import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { composite, contrast, parseColor, type Rgba } from './color';
import {
  colors,
  colorsContrastMore,
  colorsVibrancySidebar,
  colorsVibrancySidebarContrastMore,
  defaultUiTextSize,
  density,
  inactiveOpacity,
  layout,
  space,
  tagColors,
  typeScale,
  uiTextSizes,
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

        it('grouped surfaces: the settings window\'s groups and a sheet\'s .card keep secondary text at 4.5:1 (carried T6 check)', () => {
          // Settings (design-spec 6 설정 창): groups are --bg-control on --bg-window; a sheet's .card is --fill-hover on --bg-raised.
          const group = onLayers(c, ['bgControl'], 'bgWindow');
          const card = onLayers(c, ['fillHover'], 'bgRaised');
          for (const [label, bg] of [['settings group', group], ['sheet card', card]] as const) {
            expectContrast(`textPrimary/${label}`, c('textPrimary'), bg, 4.5);
            expectContrast(`textSecondary/${label}`, c('textSecondary'), bg, 4.5); // hints, theme names, card meta
          }
          // A segmented control inside a group sits on its own track (bgTrackGrouped): unselected labels on the track, the
          // selected one on its raised segment, which still stands out from the track.
          const track = onLayers(c, ['bgControl', 'bgTrackGrouped'], 'bgWindow');
          const selected = onLayers(c, ['bgControl', 'bgTrackGrouped', 'bgControlSelected'], 'bgWindow');
          expectContrast('textSecondary/bgTrackGrouped@settings group', c('textSecondary'), track, 4.5);
          expectContrast('textPrimary/bgControlSelected@bgTrackGrouped@settings group', c('textPrimary'), selected, 4.5);
          expect(contrast(selected, track), 'selected segment vs track').toBeGreaterThanOrEqual(theme === 'dark' ? 1.5 : 1);
          // The plain track would not do in dark (why the grouped one exists).
          if (theme === 'dark' && mode === 'default') expect(contrast(c('textSecondary'), onLayers(c, ['bgControl', 'bgTrack'], 'bgWindow'))).toBeLessThan(4.5);
          // The library path's folder glyph (accent text) and the folder error under it.
          expectContrast('accentText icon/settings group', c('accentText'), group, 3);
          expectContrast('dangerText/settings group', c('dangerText'), group, 4.5);
          // The selected theme tile's ring and, when the window is not key, its neutral ring.
          expectContrast('accentRing/settings group', c('accentRing'), group, 3);
          expectContrast('borderStrong ring/settings group', c('borderStrong'), group, 3);
        });

        it('dividers on grouped and raised surfaces (--separator-on-surface, critic T14-m2) keep one visible contrast', () => {
          // Where it is drawn: a settings group's ring and rows (bgControl on bgWindow), a sheet card's ring and rows
          // (fillHover on bgRaised), the palette's rules, a web menu's separators and the drop overlay's off card ring
          // (bgRaised).
          const surfaces = [
            ['settings group', onLayers(c, ['bgControl'], 'bgWindow')],
            ['sheet card', onLayers(c, ['fillHover'], 'bgRaised')],
            ['palette / menu / drop card', c('bgRaised')],
          ] as const;
          for (const [label, bg] of surfaces) {
            const line = c('separatorOnSurface');
            const ratio = contrast(line.a < 1 ? composite(line, bg) : line, bg);
            if (mode === 'default') {
              // Visible but quiet, the same in both themes (the light --separator measures 1.36:1 on white).
              expect(ratio, `${label}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(1.25);
              expect(ratio, `${label}: ${ratio.toFixed(2)}`).toBeLessThanOrEqual(1.45);
            } else {
              expect(ratio, `${label} (more contrast): ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
            }
          }
          // Why it exists: the opaque --separator turns darker than the dark grouped surfaces (1.08–1.09:1).
          if (theme === 'dark' && mode === 'default') expect(contrast(c('separator'), onLayers(c, ['bgControl'], 'bgWindow'))).toBeLessThan(1.25);
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

        it('a keycap on the accent fill (the palette\'s cursor row): its white label ≥ 4.5:1 on the darkened keycap', () => {
          expectContrast('textOnAccent/bgKbdOnAccent@accent', c('textOnAccent'), on(c, 'bgKbdOnAccent', 'accent'), 4.5);
        });

        it('meter fills (progress, spinner, scrubber) ≥ 3:1 against the track on every surface', () => {
          for (const s of SURFACES) expectContrast(`meter/track@${s}`, c('meter'), on(c, 'bgTrack', s), 3);
        });

        it('focus ring and strong borders ≥ 3:1 against the surfaces they sit on', () => {
          for (const s of SURFACES) {
            expectContrast(`focus/${s}`, c('focus'), c(s), 3);
            expectContrast(`accentRing/${s}`, c('accentRing'), c(s), 3);
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

  it('not-main window chrome (design-spec 2.1, 8.3): pinned near Finder, not held to the key-window targets', () => {
    // Finder on the same runner (runs 39642950406, 39653189858): labels 172 on 236 = 1.92:1 (light), 85 on 20 =
    // 2.47:1 (dark); the selected label 147 on 211 = 2.05:1, 111 on 46 = 2.70:1; accent icons faded to 1.46 / 1.74:1.
    const band = (label: string, fg: Rgba, bg: Rgba, lo: number, hi: number) => {
      const r = contrast(fg, bg);
      expect(r, `${label}: ${r.toFixed(2)} outside ${lo}–${hi}`).toBeGreaterThanOrEqual(lo);
      expect(r, `${label}: ${r.toFixed(2)} outside ${lo}–${hi}`).toBeLessThanOrEqual(hi);
      return r;
    };
    // The inactive material (the macOS sidebar, and the toolbar there), the opaque sidebar and the Linux toolbar.
    const surfaces = (theme: Theme) => [colors.bgChromeInactive[theme], colors.bgSidebar[theme], colors.bgWindow[theme]];
    for (const theme of THEMES) {
      for (const s of surfaces(theme)) {
        const bg = parseColor(s);
        // design-spec 8.3: light 1.85–2.1:1, dark 2.4–2.7:1 (Finder 1.92 / 2.47).
        const label = band(`${theme} textInactive on ${s}`, parseColor(colors.textInactive[theme]), bg, theme === 'light' ? 1.85 : 2.4, theme === 'light' ? 2.1 : 2.7);
        // Row icons: --accent-text faded as a whole by --opacity-inactive.
        band(`${theme} accent icon at ${inactiveOpacity} on ${s}`, { ...parseColor(colors.accentText[theme]), a: inactiveOpacity }, bg, 1.3, 2.1);
        if (s === colors.bgWindow[theme]) continue; // no sidebar row sits on the toolbar
        // The selected row: its label on the selection fill, light 1.9–2.2:1, dark 2.5–2.85:1, a touch above the others.
        const fill = composite(parseColor(colors.fillSelected[theme]), bg);
        const selected = band(`${theme} textInactiveSelected on the selection over ${s}`, parseColor(colors.textInactiveSelected[theme]), fill, theme === 'light' ? 1.9 : 2.5, theme === 'light' ? 2.2 : 2.85);
        expect(selected, `${theme} on ${s}: the selected label is not fainter than the other rows`).toBeGreaterThan(label * 0.98);
      }
      // The same colours as the active roles, at the inactive alpha (35 % for the selected row).
      expect(colors.textInactive[theme]).toBe(colors.textPrimary[theme].replace(')', ` / ${inactiveOpacity})`));
      expect(colors.textInactiveSelected[theme]).toBe(colors.textPrimary[theme].replace(')', ' / 0.35)'));
      // The measured inactive material, and Finder's black chrome lines in dark.
      expect(colors.bgChromeInactive[theme]).toBe(theme === 'light' ? '#ececec' : '#141414');
    }
    expect(colors.separatorChromeInactive.light).toBe(colors.separator.light);
    expect(parseColor(colors.separatorChromeInactive.dark)).toMatchObject({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('the selection ring is the meter teal by definition, not a copy of its values (review minor 4)', () => {
    expect(colors.accentRing).toBe(colors.meter);
  });

  it('the cursor row\'s keycap darkens the accent fill (critic T9-n1: the label was the panel\'s weakest text, 3.61 / 4.03:1)', () => {
    // Pinned near the critique's measure: 6.59:1 light, 7.42:1 dark (a white keycap fill would lighten it instead).
    const ratio = (theme: Theme) => contrast(parseColor(colors.textOnAccent[theme]), composite(parseColor(colors.bgKbdOnAccent[theme]), parseColor(colors.accent[theme])));
    expect(ratio('light')).toBeCloseTo(6.59, 1);
    expect(ratio('dark')).toBeCloseTo(7.42, 1);
  });

  it('dark mode puts content below the chrome and raised surfaces above it', () => {
    const L = (key: ColorToken) => Number(/oklch\(([\d.]+)%/.exec(colors[key].dark)![1]);
    expect(L('bgContent')).toBeLessThan(L('bgSidebar'));
    expect(L('bgSidebar')).toBeLessThan(L('bgWindow'));
    expect(L('bgWindow')).toBeLessThan(L('bgRaised'));
  });
});

describe('sidebar text over the macOS vibrancy material (design-spec 8.3)', () => {
  /**
   * The material is the system's. Measured on the macos-15 runner: active light #f6f6f6 and dark #383838 (run
   * 39618864364), inactive light #ececec and dark #141414 (run 39631541294). Active dark is tested at #404040, a margin
   * above the measurement (a mid-tone wallpaper lightens it on real hardware); #ececec is the light worst case.
   */
  const MATERIALS: Record<Theme, readonly string[]> = { light: ['#f6f6f6', '#ececec'], dark: ['#404040', '#141414'] };
  type SidebarToken = ColorToken | keyof typeof colorsVibrancySidebar;

  for (const theme of THEMES) {
    for (const [mode, base, sidebar] of [
      ['default', {}, colorsVibrancySidebar],
      ['prefers-contrast: more', colorsContrastMore, colorsVibrancySidebarContrastMore],
    ] as const) {
      for (const hex of MATERIALS[theme]) it(`${theme} on ${hex} (${mode}): labels 4.5:1, section labels and counts 3:1, a selected row's count 4.5:1, icons and focus 3:1`, () => {
        const pick = (k: SidebarToken): Rgba =>
          parseColor(((sidebar as Partial<Record<SidebarToken, ThemePair>>)[k] ?? (base as Partial<Record<SidebarToken, ThemePair>>)[k] ?? colors[k as ColorToken])[theme]);
        const material = parseColor(hex);
        const hover = composite(pick('fillHover'), material);
        const selected = composite(pick('fillSelected'), material);
        for (const [bg, name] of [[material, 'material'], [hover, 'hovered row'], [selected, 'selected row']] as const) {
          expectContrast(`textPrimary/${name}`, pick('textPrimary'), bg, 4.5); // row labels
          expectContrast(`accentText icon/${name}`, pick('accentText'), bg, 3); // row icons
        }
        for (const [bg, name] of [[material, 'material'], [hover, 'hovered row']] as const) {
          expectContrast(`textTertiary/${name}`, pick('textTertiary'), bg, 3); // section labels, counts
        }
        expectContrast('sidebarCountSelected/selected row', pick('sidebarCountSelected'), selected, 4.5);
        expectContrast('focus/material', pick('focus'), material, 3);
      });
      // The ⌘K launcher: a field (--bg-field, --border) with a keycap (--bg-control) on the material. Roles (8.3, 6):
      // the placeholder and the magnifier are tertiary text and an icon (3:1); the keycap label is a shortcut, which
      // menus and tooltips show in the tertiary role (3:1). Idle, hovered and pressed; the field ring is the focus test above.
      for (const hex of MATERIALS[theme]) it(`${theme} on ${hex} (${mode}): the ⌘K launcher's placeholder, glyph and keycap 3:1`, () => {
        const pick = (k: SidebarToken): Rgba =>
          parseColor(((sidebar as Partial<Record<SidebarToken, ThemePair>>)[k] ?? (base as Partial<Record<SidebarToken, ThemePair>>)[k] ?? colors[k as ColorToken])[theme]);
        const material = parseColor(hex);
        const field = composite(pick('bgField'), material);
        for (const [state, under] of [['idle', field], ['hovered', composite(pick('fillHover'), field)], ['pressed', composite(pick('fillPressed'), field)]] as const) {
          expectContrast(`fieldPlaceholder/${state} field`, pick('fieldPlaceholder'), under, 3);
          expectContrast(`kbdText/keycap on the ${state} field`, pick('kbdText'), composite(pick('bgControl'), under), 3);
        }
        if (mode === 'prefers-contrast: more') expectContrast('border/material', composite(pick('border'), material), material, 3);
      });
    }
  }

  it('the tag selector\'s top rule uses the translucent separator over the material (the opaque one is the material\'s own grey)', () => {
    for (const theme of THEMES) {
      for (const hex of MATERIALS[theme]) {
        const material = parseColor(hex);
        const line = composite(parseColor(colors.separatorOnSurface[theme]), material);
        expect(contrast(line, material), `${theme} on ${hex}`).toBeGreaterThanOrEqual(1.25);
      }
    }
    expect(contrast(parseColor(colors.separator.dark), parseColor(MATERIALS.dark[0]!))).toBeLessThan(1.25);
    const css = fs.readFileSync(new URL('../styles/screens/tags.css', import.meta.url), 'utf8');
    expect(css).toMatch(/:root\[data-vibrancy='1'\] \.tag-selector\s*\{[^}]*border-top-color:\s*var\(--separator-on-surface\)/);
  });
  it('the base tokens alone would fail on the dark material (why the sidebar has its own)', () => {
    const material = parseColor(MATERIALS.dark[0]!);
    expect(contrast(parseColor(colors.textTertiary.dark), material)).toBeLessThan(3);
    expect(contrast(parseColor(colors.textSecondary.dark), composite(parseColor(colors.fillSelected.dark), material))).toBeLessThan(4.5);
    // The launcher: the sidebar's own tertiary on the hovered field, and the keycap's secondary label on it.
    const hovered = composite(parseColor(colors.fillHover.dark), composite(parseColor(colors.bgField.dark), material));
    expect(contrast(parseColor(colorsVibrancySidebar.textTertiary.dark), hovered)).toBeLessThan(3);
    expect(contrast(parseColor(colors.textSecondary.dark), composite(parseColor(colors.bgControl.dark), hovered))).toBeLessThan(3);
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

  it('UI text sizes match prefs.fontSize and scale from 13', () => {
    expect([...uiTextSizes]).toEqual([12, 13, 14, 15]);
    expect(defaultUiTextSize).toBe(13);
    const css = fs.readFileSync(path.join(import.meta.dirname, 'tokens.css'), 'utf8');
    expect(css).toContain('--type-body: 400 round(calc(13px * var(--text-scale)), 1px)/round(calc(18px * var(--text-scale)), 2px) var(--font-ui);');
    // Semibold roles keep the weight token (Task 8 n6).
    expect(css).toContain('--type-headline: var(--weight-semibold) round(calc(13px * var(--text-scale)), 1px)/round(calc(18px * var(--text-scale)), 2px) var(--font-ui);');
    expect(css).toContain("  :root[data-font-size='15'] {\n    --text-scale: calc(15 / 13);");
    expect(css).not.toContain("data-font-size='13'"); // 13 is the default: --text-scale 1
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
