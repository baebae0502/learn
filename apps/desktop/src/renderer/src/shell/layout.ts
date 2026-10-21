import { layout } from '../design/tokens';

/** Sidebar width in px: one width for every view (design-spec 2.1, layout B invariant). */
export const SIDEBAR = { default: layout.sidebarWidth, min: layout.sidebarMin, max: layout.sidebarMax } as const;
/**
 * The content column never gets narrower than this: below it the sidebar folds away by itself (design-spec 2.1
 * "창이 960에 가까워지면 … 자동 접힌다", 8.3 200 % zoom without sideways scrolling). 520 fits the library table's
 * title column plus kind, size and date (88 + 88 + 132) with its 16 px insets. M4 adds the item panel before the
 * sidebar in this order.
 */
export const CONTENT_MIN = 520;

export interface SidebarState {
  width: number;
  /** The user hid it (⌃⌘S or dragged it shut). Persisted. */
  collapsed: boolean;
  /** The user showed it while the window is too narrow for it. Session only. */
  forceShown: boolean;
}

export const clampSidebar = (w: number): number => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(w)));
export const autoCollapses = (viewportWidth: number, sidebarWidth: number): boolean => viewportWidth < sidebarWidth + CONTENT_MIN;
export const sidebarHidden = (s: SidebarState, viewportWidth: number): boolean => s.collapsed || (autoCollapses(viewportWidth, s.width) && !s.forceShown);

export function toggledSidebar(s: SidebarState, viewportWidth: number): SidebarState {
  if (sidebarHidden(s, viewportWidth)) return { ...s, collapsed: false, forceShown: autoCollapses(viewportWidth, s.width) };
  return { ...s, collapsed: true, forceShown: false };
}

export function afterViewportChange(s: SidebarState, viewportWidth: number): SidebarState {
  return s.forceShown && !autoCollapses(viewportWidth, s.width) ? { ...s, forceShown: false } : s;
}

export function parsePanes(raw: unknown): SidebarState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const width = typeof r['sidebar'] === 'number' ? clampSidebar(r['sidebar']) : SIDEBAR.default;
  return { width, collapsed: r['sidebarCollapsed'] === 1, forceShown: false };
}

export const serializePanes = (s: SidebarState): Record<string, number> => ({ sidebar: s.width, sidebarCollapsed: s.collapsed ? 1 : 0 });
