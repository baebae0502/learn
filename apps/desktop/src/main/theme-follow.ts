import type { Prefs } from '@learn/domain';

export type Shade = 'light' | 'dark';

/** How long a theme change made in a page waits for the pages' reports before the native theme follows anyway. */
export const THEME_FOLLOW_MS = 250;

/** One step of a theme change, for the evidence run (theme-switch.json). */
export interface ThemeMark {
  event: 'requested' | 'shown' | 'chrome' | 'source';
  /** A follower's webContents id ('shown', 'chrome'). */
  windowId?: number;
  /** 'source': why it applied now. */
  reason?: 'shown' | 'timeout';
  theme?: Prefs['theme'] | Shade;
  at: number;
}

export interface ThemeFollowDeps {
  /** nativeTheme.themeSource: one value for the whole app (the macOS title bars and vibrancy, sheets, prefers-color-scheme). */
  applySource(theme: Prefs['theme']): void;
  /** One window's own chrome for the shade its page now shows (the Linux window-controls overlay, its background). */
  applyWindowChrome(windowId: number, shade: Shade): void;
  /** The open pages that draw the theme themselves and report it (the main and the settings window): webContents ids. */
  followers(): number[];
  /**
   * The shade the pages draw for `theme` now: the pref itself, and for 시스템 설정 the appearance they see while the
   * native theme is still the old one (prefers-color-scheme follows nativeTheme.themeSource, which follows them).
   */
  shadeOf(theme: Prefs['theme']): Shade;
  mark?(mark: ThemeMark): void;
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

export interface ThemeFollower {
  /**
   * A page changed the theme pref. The pages lead: each follower's own chrome follows when its page reports the theme
   * on screen (`shown`), and the app-wide native theme once every follower has (or after THEME_FOLLOW_MS).
   */
  pageChanged(theme: Prefs['theme']): void;
  /**
   * A follower's page now shows `shade` (the frame after it swapped; a crossfade's update where one runs). Only the report of the
   * pending change counts: one in another shade is a late report of a change before it, and is ignored.
   */
  shown(windowId: number, shade: Shade): void;
}

/**
 * T13R4-m1: the native theme follows the page. AppKit repaints a title bar and the vibrancy a few frames after it is
 * told, and Linux draws its window-controls overlay at once; a page's crossfade would start later than either (so
 * pages no longer crossfade: settings/theme.ts crossfades). So for a
 * change made in a page, main applies nothing native until the pages show it: never a native part already in the new
 * theme over web content still wholly in the old one. A page that never reports (hung, closed) holds it at most
 * THEME_FOLLOW_MS. A change no page made (startup, the system appearance) never comes here: main applies it at once.
 *
 * Each report names the shade it shows, and is taken only for the pending change's shade. With light → dark → light in
 * quick succession, the dark change's report can arrive after the light one began; taken for it, that window's chrome
 * would stay dark and the light report, its real one, would be ignored as a second.
 */
export function createThemeFollower(deps: ThemeFollowDeps): ThemeFollower {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const mark = (m: Omit<ThemeMark, 'at'>) => deps.mark?.({ ...m, at: now() });
  let pending: { theme: Prefs['theme']; shade: Shade; waiting: Set<number>; timer: unknown } | null = null;

  const settle = (reason: 'shown' | 'timeout') => {
    if (!pending) return;
    const { theme, timer } = pending;
    clearTimer(timer);
    pending = null;
    deps.applySource(theme);
    mark({ event: 'source', reason, theme });
  };

  return {
    pageChanged(theme) {
      if (pending) {
        // A second pick before the first was shown: the first one's native theme is skipped, not applied late.
        clearTimer(pending.timer);
        pending = null;
      }
      mark({ event: 'requested', theme });
      const waiting = new Set(deps.followers());
      if (waiting.size === 0) {
        deps.applySource(theme);
        mark({ event: 'source', reason: 'shown', theme });
        return;
      }
      pending = { theme, shade: deps.shadeOf(theme), waiting, timer: setTimer(() => settle('timeout'), THEME_FOLLOW_MS) };
    },
    shown(windowId, shade) {
      if (!pending || shade !== pending.shade || !pending.waiting.has(windowId)) return;
      mark({ event: 'shown', windowId, theme: shade });
      pending.waiting.delete(windowId);
      deps.applyWindowChrome(windowId, shade);
      mark({ event: 'chrome', windowId, theme: shade });
      if (pending.waiting.size === 0) settle('shown');
    },
  };
}
