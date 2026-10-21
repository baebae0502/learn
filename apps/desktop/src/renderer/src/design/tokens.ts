/**
 * Learn design tokens — the single source of truth.
 *
 * `apps/desktop/scripts/build-tokens.mjs` turns this file into
 *   - `tokens.css` (CSS custom properties; colours use `light-dark()` so one value
 *     follows the active `color-scheme`, plus a `prefers-contrast: more` layer), and
 *   - `tokens.generated.ts` (per-theme hex values for the main process: window
 *     background and `titleBarOverlay`, so the window never flashes white).
 * Edit values here, then run `pnpm tokens`. `tokens.test.ts` checks contrast and that
 * the generated files are up to date.
 *
 * Rules: this module has no imports (Node loads it with type stripping) and uses only
 * erasable TypeScript syntax.
 *
 * Colour model: neutral greys share hue 250 with chroma ≤ 0.01 (cool, almost grey);
 * the accent is generated Linear-style from a base hue — `accent` (fills: focused
 * selection, primary button), `accentText` (links and accent glyphs on surfaces) and
 * `textOnAccent` (labels on accent fills).
 */

export interface ThemePair {
  readonly light: string;
  readonly dark: string;
}

/** Hue (OKLCH degrees) of the neutral greys and of the accent. */
export const hues = { neutral: 250, accent: 190 } as const;

/**
 * Theme colours. Keys become CSS custom properties in kebab case
 * (`bgWindow` → `--bg-window`). Values are OKLCH (or hex for fixed palettes).
 */
export const colors = {
  // ── Surfaces ────────────────────────────────────────────────────────────────
  /** Window chrome: title bar, toolbars, pane headers outside the content. */
  bgWindow: { light: 'oklch(97.6% 0.002 250)', dark: 'oklch(26.5% 0.004 250)' },
  /** Sidebar material (vibrancy on macOS; this is the opaque fallback). */
  bgSidebar: { light: 'oklch(95.6% 0.004 250)', dark: 'oklch(24.5% 0.005 250)' },
  /** Content: item table, item pane, transcript. In dark mode it sits *below* the chrome. */
  bgContent: { light: 'oklch(100% 0 0)', dark: 'oklch(21.5% 0.004 250)' },
  /** Alternate row stripe on content. */
  bgContentAlt: { light: 'oklch(98.4% 0.0015 250)', dark: 'oklch(22.8% 0.004 250)' },
  /** Menus, popovers, dialogs, toasts — elevation is lighter in dark mode. */
  bgRaised: { light: 'oklch(100% 0 0)', dark: 'oklch(30% 0.005 250)' },
  /** Reader backdrop behind PDF pages. */
  bgSunken: { light: 'oklch(93.2% 0.004 250)', dark: 'oklch(17.5% 0.004 250)' },
  /** Text fields and search fields. */
  bgField: { light: 'oklch(100% 0 0)', dark: 'oklch(100% 0 0 / 0.055)' },
  /** Push buttons (secondary) and segmented controls. */
  bgControl: { light: 'oklch(100% 0 0)', dark: 'oklch(100% 0 0 / 0.1)' },
  /** Selected segment in a segmented control. */
  bgControlSelected: { light: 'oklch(100% 0 0)', dark: 'oklch(100% 0 0 / 0.2)' },
  /** Track behind segmented controls and progress bars. */
  bgTrack: { light: 'oklch(23% 0.01 250 / 0.07)', dark: 'oklch(100% 0 0 / 0.08)' },
  /** Modal backdrop. */
  bgScrim: { light: 'oklch(20% 0.01 250 / 0.24)', dark: 'oklch(0% 0 0 / 0.5)' },

  // ── State fills (translucent so they work on every surface) ────────────────
  fillHover: { light: 'oklch(23% 0.01 250 / 0.05)', dark: 'oklch(100% 0 0 / 0.06)' },
  fillPressed: { light: 'oklch(23% 0.01 250 / 0.09)', dark: 'oklch(100% 0 0 / 0.1)' },
  /** Selection when the list does not have keyboard focus (neutral, macOS-style). */
  fillSelected: { light: 'oklch(23% 0.01 250 / 0.13)', dark: 'oklch(100% 0 0 / 0.13)' },

  // ── Lines ───────────────────────────────────────────────────────────────────
  /** Hairlines between panes, table header rule. */
  separator: { light: 'oklch(89.5% 0.004 250)', dark: 'oklch(33% 0.005 250)' },
  /** Control and card borders. */
  border: { light: 'oklch(86% 0.005 250)', dark: 'oklch(100% 0 0 / 0.12)' },
  /** ≥ 3:1 boundary for controls that need one (checkbox, radio, high-contrast mode). */
  borderStrong: { light: 'oklch(60% 0.008 250)', dark: 'oklch(62% 0.008 250)' },

  // ── Text ────────────────────────────────────────────────────────────────────
  textPrimary: { light: 'oklch(23% 0.008 250)', dark: 'oklch(94% 0.004 250)' },
  /** Secondary labels and icons. Body-text safe (≥ 4.5:1 on every surface). */
  textSecondary: { light: 'oklch(46% 0.01 250)', dark: 'oklch(78% 0.008 250)' },
  /** Placeholders, counts, disabled. ≥ 3:1 — never for information-bearing body text. */
  textTertiary: { light: 'oklch(60% 0.008 250)', dark: 'oklch(58% 0.008 250)' },
  textOnAccent: { light: 'oklch(100% 0 0)', dark: 'oklch(100% 0 0)' },

  // ── Accent (base / accent / contrast) ──────────────────────────────────────
  accent: { light: 'oklch(53% 0.088 190)', dark: 'oklch(50% 0.084 190)' },
  accentHover: { light: 'oklch(49% 0.082 190)', dark: 'oklch(54% 0.09 190)' },
  accentPressed: { light: 'oklch(45% 0.076 190)', dark: 'oklch(46% 0.078 190)' },
  accentText: { light: 'oklch(49% 0.082 190)', dark: 'oklch(78% 0.1 190)' },
  accentSoft: { light: 'oklch(53% 0.088 190 / 0.11)', dark: 'oklch(72% 0.1 190 / 0.16)' },
  focus: { light: 'oklch(57% 0.096 190)', dark: 'oklch(72% 0.11 190)' },
  /** Progress fills, spinner arcs, scrubber "played": ≥ 3:1 against the track in both themes
      (the dark accent fill is too dark for that; it is tuned for white text on it). */
  meter: { light: 'oklch(53% 0.088 190)', dark: 'oklch(66% 0.11 190)' },

  // ── Semantic ────────────────────────────────────────────────────────────────
  danger: { light: 'oklch(56% 0.19 27)', dark: 'oklch(64% 0.18 25)' },
  dangerText: { light: 'oklch(51% 0.18 27)', dark: 'oklch(76% 0.13 25)' },
  dangerSoft: { light: 'oklch(56% 0.19 27 / 0.1)', dark: 'oklch(64% 0.18 25 / 0.18)' },
  warning: { light: 'oklch(76% 0.15 72)', dark: 'oklch(80% 0.14 78)' },
  warningText: { light: 'oklch(50% 0.11 62)', dark: 'oklch(83% 0.12 80)' },
  warningSoft: { light: 'oklch(80% 0.15 80 / 0.18)', dark: 'oklch(80% 0.14 78 / 0.14)' },
  success: { light: 'oklch(60% 0.14 150)', dark: 'oklch(70% 0.14 150)' },
  successText: { light: 'oklch(48% 0.12 150)', dark: 'oklch(80% 0.12 150)' },
  successSoft: { light: 'oklch(60% 0.14 150 / 0.12)', dark: 'oklch(70% 0.14 150 / 0.16)' },

  // ── Reader ─────────────────────────────────────────────────────────────────
  /** Find-in-document matches (teal, so they never read as a yellow highlight annotation). */
  findMatch: { light: 'oklch(72% 0.12 190 / 0.3)', dark: 'oklch(72% 0.12 190 / 0.32)' },
  findMatchCurrent: { light: 'oklch(68% 0.11 190 / 0.6)', dark: 'oklch(70% 0.11 190 / 0.62)' },
  /** Letterbox around video in both themes. */
  videoStage: { light: 'oklch(14% 0.003 250)', dark: 'oklch(12% 0.003 250)' },
} as const satisfies Record<string, ThemePair>;

export type ColorToken = keyof typeof colors;

/** `prefers-contrast: more` overrides: stronger lines and secondary text, no translucent borders. */
export const colorsContrastMore = {
  separator: { light: 'oklch(62% 0.008 250)', dark: 'oklch(60% 0.008 250)' },
  border: { light: 'oklch(58% 0.008 250)', dark: 'oklch(64% 0.008 250)' },
  textSecondary: { light: 'oklch(36% 0.01 250)', dark: 'oklch(87% 0.006 250)' },
  textTertiary: { light: 'oklch(46% 0.01 250)', dark: 'oklch(74% 0.008 250)' },
  fillSelected: { light: 'oklch(23% 0.01 250 / 0.19)', dark: 'oklch(100% 0 0 / 0.22)' },
  accentText: { light: 'oklch(42% 0.072 190)', dark: 'oklch(84% 0.09 190)' },
} as const satisfies Partial<Record<ColorToken, ThemePair>>;

/**
 * Sidebar text over the macOS vibrancy material (`:root[data-vibrancy='1'] .sidebar`; the opaque fallback keeps the
 * base tokens). The material is the system's: the macos-15 runner measured #f6f6f6 in light and #383838 in dark (run
 * 39618864364). In dark that is far lighter than the opaque `--bg-sidebar`, so the dark tertiary text is lifted and a
 * selected row's count uses primary text. tokens.test.ts checks every sidebar text role on worst-case materials
 * (dark #404040, light #f6f6f6). `sidebarCountSelected` exists only here (the opaque sidebar uses --text-secondary).
 */
export const colorsVibrancySidebar = {
  textTertiary: { light: colors.textTertiary.light, dark: 'oklch(70% 0.008 250)' },
  sidebarCountSelected: { light: colors.textSecondary.light, dark: colors.textPrimary.dark },
} as const satisfies Record<string, ThemePair>;

/** The same under `prefers-contrast: more` (the sidebar's own values would otherwise shadow the stronger ones). */
export const colorsVibrancySidebarContrastMore = {
  textTertiary: colorsContrastMore.textTertiary,
  sidebarCountSelected: { light: colorsContrastMore.textSecondary.light, dark: colors.textPrimary.dark },
} as const satisfies Record<keyof typeof colorsVibrancySidebar, ThemePair>;

/**
 * Annotation and tag colours (positions 1–8, keys 1–8). Same values in both themes;
 * on dark pages highlights are drawn with lower opacity instead of different hues.
 */
export const tagColors = [
  { position: 1, id: 'yellow', name: '노랑', hex: '#ffd400' },
  { position: 2, id: 'red', name: '빨강', hex: '#ff6666' },
  { position: 3, id: 'green', name: '초록', hex: '#5fb236' },
  { position: 4, id: 'blue', name: '파랑', hex: '#2ea8e5' },
  { position: 5, id: 'purple', name: '보라', hex: '#a28ae5' },
  { position: 6, id: 'magenta', name: '자홍', hex: '#e56eee' },
  { position: 7, id: 'orange', name: '주황', hex: '#f19837' },
  { position: 8, id: 'gray', name: '회색', hex: '#aaaaaa' },
] as const;

/** Reader page themes (independent of the app theme; default follows the app theme). */
export const pageThemes = {
  original: { bg: '#ffffff', text: '#1b1d20', muted: '#5f646b', rule: '#d9dce1' },
  sepia: { bg: 'oklch(95.2% 0.028 85)', text: 'oklch(34% 0.035 60)', muted: 'oklch(50% 0.035 65)', rule: 'oklch(85% 0.03 80)' },
  dark: { bg: 'oklch(24% 0.004 250)', text: 'oklch(88% 0.004 250)', muted: 'oklch(70% 0.006 250)', rule: 'oklch(36% 0.005 250)' },
} as const;

/** Highlight opacity per page theme (highlights blend with `multiply` on light pages). */
export const highlightAlpha = { original: 0.4, sepia: 0.4, dark: 0.32 } as const;

/** 4 px grid. Names are the pixel value: `--space-12` is 12 px. */
export const space = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48] as const;

export const radius = {
  /** Keycaps, tag dots' hit area, small badges. */
  xs: 3,
  /** Chips, small buttons inside fields. */
  sm: 4,
  /** Buttons, fields, list rows, tabs. */
  md: 6,
  /** Menus, popovers, cards, toasts. */
  lg: 8,
  /** Dialogs and sheets. */
  xl: 12,
  pill: 999,
} as const;

export const fonts = {
  /** macOS: SF Pro + Apple SD Gothic Neo; elsewhere Pretendard (bundled, OFL). */
  system: '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard Variable", system-ui, sans-serif',
  /** Pretendard everywhere (owner decision pending; mockups switch with ?font=pretendard). */
  pretendard: '"Pretendard Variable", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "DejaVu Sans Mono", monospace',
} as const;

/** Type roles: size / line height / weight. Body is 13/18 like macOS. Korean UI avoids 700. */
/**
 * Font weights. Korean UI never goes above 600 (design-spec 4). `semibold` is every title and emphasis role; it is a
 * token so its value can follow what macOS actually draws (Task 8 n6: at 600 Chromium picks SF Bold for Latin next to
 * Apple SD Gothic Neo SemiBold for Hangul).
 */
export const fontWeight = { regular: 400, medium: 500, semibold: 600 } as const;

export const typeScale = {
  caption: { size: 11, line: 14, weight: fontWeight.regular },
  footnote: { size: 12, line: 16, weight: fontWeight.regular },
  body: { size: 13, line: 18, weight: fontWeight.regular },
  headline: { size: 13, line: 18, weight: fontWeight.semibold },
  /** Multi-line Korean at UI size (dialog messages, transcript, descriptions). */
  paragraph: { size: 13, line: 20, weight: fontWeight.regular },
  /** Reading text: empty-state copy, notes; Korean paragraphs at 14/22. */
  callout: { size: 14, line: 22, weight: fontWeight.regular },
  title3: { size: 15, line: 20, weight: fontWeight.semibold },
  title2: { size: 17, line: 22, weight: fontWeight.semibold },
  title1: { size: 22, line: 28, weight: fontWeight.semibold },
  mono: { size: 12, line: 16, weight: fontWeight.regular },
} as const;

/** List/table row heights by density. */
export const density = { compact: 24, regular: 28, comfortable: 32 } as const;
export const defaultDensity = 'regular' satisfies keyof typeof density;

/** Window and panel geometry (px). */
export const layout = {
  toolbarHeight: 52,
  paneHeaderHeight: 44,
  tabHeight: 28,
  tableHeaderHeight: 28,
  controlHeight: 28,
  controlHeightSmall: 22,
  controlHeightLarge: 32,
  hitTarget: 28,
  iconSize: 16,
  iconSizeSmall: 14,
  sidebarWidth: 240,
  sidebarMin: 180,
  sidebarMax: 360,
  inspectorWidth: 320,
  inspectorMin: 260,
  inspectorMax: 480,
  transcriptWidth: 320,
  /** Traffic-light group origin for `trafficLightPosition` (verify on the macOS runner in M3). */
  trafficLightX: 18,
  trafficLightY: 18,
  /** Left inset reserved for the traffic lights inside a 52 px bar. */
  trafficLightInset: 84,
  windowMinWidth: 960,
  windowMinHeight: 600,
} as const;

/** lucide stroke width in its 24-unit grid (1.5 → 1 px at 16 px). */
export const iconStroke = 1.5;

export const motion = {
  fast: 100,
  base: 160,
  slow: 240,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/**
 * Elevation. Every shadow has the same layer structure in both themes so a single
 * `light-dark()` per layer works: hairline ring, inner top highlight (dark only),
 * then soft drop shadows.
 */
export const shadows = {
  /** Menus, popovers, find bar, toasts. */
  e1: [
    { x: 0, y: 0, blur: 0, spread: 0.5, color: { light: 'oklch(20% 0.01 250 / 0.14)', dark: 'oklch(100% 0 0 / 0.12)' } },
    { inset: true, x: 0, y: 0.5, blur: 0, spread: 0, color: { light: 'oklch(100% 0 0 / 0)', dark: 'oklch(100% 0 0 / 0.07)' } },
    { x: 0, y: 4, blur: 12, spread: 0, color: { light: 'oklch(20% 0.01 250 / 0.08)', dark: 'oklch(0% 0 0 / 0.32)' } },
    { x: 0, y: 12, blur: 32, spread: -4, color: { light: 'oklch(20% 0.01 250 / 0.1)', dark: 'oklch(0% 0 0 / 0.36)' } },
  ],
  /** Dialogs and sheets. */
  e2: [
    { x: 0, y: 0, blur: 0, spread: 0.5, color: { light: 'oklch(20% 0.01 250 / 0.16)', dark: 'oklch(100% 0 0 / 0.14)' } },
    { inset: true, x: 0, y: 0.5, blur: 0, spread: 0, color: { light: 'oklch(100% 0 0 / 0)', dark: 'oklch(100% 0 0 / 0.08)' } },
    { x: 0, y: 8, blur: 24, spread: 0, color: { light: 'oklch(20% 0.01 250 / 0.12)', dark: 'oklch(0% 0 0 / 0.4)' } },
    { x: 0, y: 24, blur: 64, spread: -8, color: { light: 'oklch(20% 0.01 250 / 0.18)', dark: 'oklch(0% 0 0 / 0.5)' } },
  ],
  /** Raised segment / active tab: barely there. */
  e0: [
    { x: 0, y: 0, blur: 0, spread: 0.5, color: { light: 'oklch(20% 0.01 250 / 0.12)', dark: 'oklch(100% 0 0 / 0.06)' } },
    { inset: true, x: 0, y: 0.5, blur: 0, spread: 0, color: { light: 'oklch(100% 0 0 / 0)', dark: 'oklch(100% 0 0 / 0.06)' } },
    { x: 0, y: 1, blur: 2, spread: 0, color: { light: 'oklch(20% 0.01 250 / 0.08)', dark: 'oklch(0% 0 0 / 0.24)' } },
  ],
  /** PDF page on the sunken backdrop. */
  page: [
    { x: 0, y: 0, blur: 0, spread: 0.5, color: { light: 'oklch(20% 0.01 250 / 0.1)', dark: 'oklch(0% 0 0 / 0.5)' } },
    { x: 0, y: 1, blur: 3, spread: 0, color: { light: 'oklch(20% 0.01 250 / 0.1)', dark: 'oklch(0% 0 0 / 0.4)' } },
  ],
} as const;

/** Focus ring geometry: 2 px `--focus` outline offset 1 px on controls, inset on rows. */
export const focusRing = { width: 2, offset: 1 } as const;
