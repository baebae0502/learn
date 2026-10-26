import { layout } from '../design/tokens';

/** Sidebar width in px: one width for every view (design-spec 2.1, layout B invariant). */
export const SIDEBAR = { default: layout.sidebarWidth, min: layout.sidebarMin, max: layout.sidebarMax } as const;
/** Item panel width in px, info mode (design-spec 2.5: 정보 320, 260–480; the tutor mode gets its own in T1). */
export const INSPECTOR = { default: layout.inspectorWidth, min: layout.inspectorMin, max: layout.inspectorMax } as const;
/**
 * The content column never gets narrower than this: below it the item panel folds away by itself, then the sidebar
 * (design-spec 2.1 "항목 패널 → 사이드바 순으로 자동 접힌다", 8.3 200 % zoom without sideways scrolling). The M4
 * table's default columns at their default widths need 664 (200 + 180 + 64 + 88 + 132, the column catalogue): in a
 * column between 520 and that the table scrolls sideways inside its own scroll view (.library-table), never the window.
 */
export const CONTENT_MIN = 520;

export interface PaneState {
  width: number;
  /** The user hid it (its toggle, its shortcut, or dragged shut). Persisted. */
  collapsed: boolean;
  /** The user showed it while the window is too narrow for it. Session only. */
  forceShown: boolean;
}
/** The sidebar's state: the shape both panes share. */
export type SidebarState = PaneState;
/** Both panes, as layout.panes stores them: one record, so no writer can drop the other pane's keys. */
export interface PanesState {
  sidebar: PaneState;
  inspector: PaneState;
}

export const clampSidebar = (w: number): number => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(w)));
export const clampInspector = (w: number): number => Math.min(INSPECTOR.max, Math.max(INSPECTOR.min, Math.round(w)));
export const autoCollapses = (viewportWidth: number, sidebarWidth: number): boolean => viewportWidth < sidebarWidth + CONTENT_MIN;
export const sidebarHidden = (s: SidebarState, viewportWidth: number): boolean => s.collapsed || (autoCollapses(viewportWidth, s.width) && !s.forceShown);

/** What the content column and the item panel share: the window less a shown sidebar (the toolbar's width too). */
const mainColumnWidth = (p: PanesState, viewportWidth: number): number => viewportWidth - (sidebarHidden(p.sidebar, viewportWidth) ? 0 : p.sidebar.width);
/** The item panel does not fit beside the content column's minimum. */
export const inspectorAutoCollapses = (p: PanesState, viewportWidth: number): boolean => mainColumnWidth(p, viewportWidth) < p.inspector.width + CONTENT_MIN;

/**
 * Which panes are out of sight at this width. The sidebar keeps its own rule (it folds below its width + 520), and the
 * item panel folds whenever it does not fit beside the content column: so it always goes first. `inspectorPresent`:
 * the view has an item panel (the library with its table; spec §5.1).
 */
export function hiddenPanes(p: PanesState, viewportWidth: number, inspectorPresent: boolean): { sidebar: boolean; inspector: boolean } {
  const inspector = !inspectorPresent || p.inspector.collapsed || (inspectorAutoCollapses(p, viewportWidth) && !p.inspector.forceShown);
  return { sidebar: sidebarHidden(p.sidebar, viewportWidth), inspector };
}

export function toggledSidebar(s: SidebarState, viewportWidth: number): SidebarState {
  if (sidebarHidden(s, viewportWidth)) return { ...s, collapsed: false, forceShown: autoCollapses(viewportWidth, s.width) };
  // Shown on demand in a narrow window: folding it again hands it back to the automatic fold, not a stored collapse (M-5).
  if (s.forceShown) return { ...s, forceShown: false };
  return { ...s, collapsed: true, forceShown: false };
}

/** ⌥⌘I and the toolbar toggle, with the sidebar's rules: on demand in a narrow window, a stored choice otherwise. */
export function toggledInspector(p: PanesState, viewportWidth: number): PaneState {
  const i = p.inspector;
  if (hiddenPanes(p, viewportWidth, true).inspector) return { ...i, collapsed: false, forceShown: inspectorAutoCollapses(p, viewportWidth) };
  if (i.forceShown) return { ...i, forceShown: false };
  return { ...i, collapsed: true, forceShown: false };
}

export function afterViewportChange(s: SidebarState, viewportWidth: number): SidebarState {
  return s.forceShown && !autoCollapses(viewportWidth, s.width) ? { ...s, forceShown: false } : s;
}

export function inspectorAfterViewportChange(p: PanesState, viewportWidth: number): PaneState {
  return p.inspector.forceShown && !inspectorAutoCollapses(p, viewportWidth) ? { ...p.inspector, forceShown: false } : p.inspector;
}

/**
 * The width a drag of the item panel's boundary ends at: within 260–480 and no wider than leaves the content column its
 * 520 — wider would fold the panel the moment it is let go. A panel shown on demand is already past that rule.
 */
export function draggedInspectorWidth(p: PanesState, viewportWidth: number, px: number): number {
  return clampInspector(p.inspector.forceShown ? px : Math.min(px, mainColumnWidth(p, viewportWidth) - CONTENT_MIN));
}

/** layout.panes → both panes; a key that is missing or not a number gives that pane's default (an M3 record has the sidebar only). */
export function parsePanes(raw: unknown): PanesState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (k: string): number | null => (typeof r[k] === 'number' ? (r[k] as number) : null);
  const sidebarWidth = num('sidebar');
  const inspectorWidth = num('inspector.info');
  return {
    sidebar: { width: sidebarWidth === null ? SIDEBAR.default : clampSidebar(sidebarWidth), collapsed: r['sidebarCollapsed'] === 1, forceShown: false },
    inspector: { width: inspectorWidth === null ? INSPECTOR.default : clampInspector(inspectorWidth), collapsed: r['inspectorCollapsed'] === 1, forceShown: false },
  };
}

/** The whole layout.panes record (settings.set replaces it whole). The tutor mode's width joins it in T1. */
export const serializePanes = (p: PanesState): Record<string, number> => ({
  sidebar: p.sidebar.width,
  sidebarCollapsed: p.sidebar.collapsed ? 1 : 0,
  'inspector.info': p.inspector.width,
  inspectorCollapsed: p.inspector.collapsed ? 1 : 0,
});
