import { layout } from '../design/tokens';

/** Sidebar width in px: one width for every view (design-spec 2.1, layout B invariant). */
export const SIDEBAR = { default: layout.sidebarWidth, min: layout.sidebarMin, max: layout.sidebarMax } as const;
/** Item panel width in px, info mode (design-spec 2.5: 정보 320, 260–480). */
export const INSPECTOR = { default: layout.inspectorWidth, min: layout.inspectorMin, max: layout.inspectorMax } as const;
/** The right panel's width in 튜터 mode (spec 8.1: 380, 320–560), remembered apart from the info mode's. */
export const TUTOR = { default: layout.tutorWidth, min: layout.tutorMin, max: layout.tutorMax } as const;
/** The reader's right panel shows one of two modes; the library has the info one only. */
export type InspectorMode = 'info' | 'tutor';
/**
 * The content column never gets narrower than this: below it the item panel folds away by itself, then the sidebar
 * (design-spec 2.1 "항목 패널 → 사이드바 순으로 자동 접힌다", 8.3 200 % zoom without sideways scrolling). The M4
 * table's default columns at their default widths need 664 (200 + 180 + 64 + 88 + 132, the column catalogue): in a
 * column between 520 and that the table scrolls sideways inside its own scroll view (.table-scroller), never the window.
 */
export const CONTENT_MIN = 520;
/**
 * The reader's column keeps less: a page at 464 px still reads, and the item panel then stays at 1024 (240 + 320 + 440 = 1000);
 * below that the panel folds first. Only the item panel's fold uses it — the sidebar keeps CONTENT_MIN.
 */
export const READER_CONTENT_MIN = 440;
/** The content column's minimum that decides the item panel's fold in this view. */
export const inspectorContentMin = (view: 'library' | 'reader'): number => (view === 'reader' ? READER_CONTENT_MIN : CONTENT_MIN);

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
  /** The slot's own state (fold, forced on demand) and the info mode's width. */
  inspector: PaneState;
  /** The tutor mode's width: the user's choice, which a narrow window narrows without forgetting. */
  tutorWidth: number;
}

export const clampSidebar = (w: number): number => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(w)));
export const clampInspector = (w: number): number => Math.min(INSPECTOR.max, Math.max(INSPECTOR.min, Math.round(w)));
export const clampTutor = (w: number): number => Math.min(TUTOR.max, Math.max(TUTOR.min, Math.round(w)));
export const autoCollapses = (viewportWidth: number, sidebarWidth: number): boolean => viewportWidth < sidebarWidth + CONTENT_MIN;
export const sidebarHidden = (s: SidebarState, viewportWidth: number): boolean => s.collapsed || (autoCollapses(viewportWidth, s.width) && !s.forceShown);

/** What the content column and the right panel share, before the sidebar gives way to a shown tutor (the sidebar's own state). */
const ownMainColumnWidth = (p: PanesState, viewportWidth: number): number => viewportWidth - (sidebarHidden(p.sidebar, viewportWidth) ? 0 : p.sidebar.width);
/** What the slot's fold needs: the info panel its width, the tutor only its narrowest (spec 8.10: it narrows before it folds). */
const slotNeed = (p: PanesState, mode: InspectorMode): number => (mode === 'tutor' ? TUTOR.min : p.inspector.width);
/**
 * The right panel does not fit beside the content column's minimum. Judged with the sidebar's own state, never the one it
 * takes while a tutor shown on demand pushes it away: that one would say "fits" and undo the choice that caused it.
 */
export const inspectorAutoCollapses = (p: PanesState, viewportWidth: number, contentMin: number = CONTENT_MIN, mode: InspectorMode = 'info'): boolean =>
  ownMainColumnWidth(p, viewportWidth) < slotNeed(p, mode) + contentMin;

/**
 * The sidebar is out of sight: folded by the user or by the window, or — tutor mode only — pushed away by a tutor the user
 * showed in a window too narrow for both (the pane shown last wins, spec 8.10). Nothing is stored for the last.
 */
export function sidebarHiddenIn(p: PanesState, viewportWidth: number, contentMin: number = CONTENT_MIN, mode: InspectorMode = 'info', inspectorPresent = true): boolean {
  if (sidebarHidden(p.sidebar, viewportWidth)) return true;
  // A view without a right panel (a video, a picture, a PDF that is not open) has nothing to push the sidebar away for.
  return inspectorPresent && mode === 'tutor' && p.inspector.forceShown && !p.sidebar.forceShown && inspectorAutoCollapses(p, viewportWidth, contentMin, mode);
}

/** What the content column and the right panel share: the window less a shown sidebar (the toolbar's width too). */
const mainColumnWidth = (p: PanesState, viewportWidth: number, contentMin: number, mode: InspectorMode): number =>
  viewportWidth - (sidebarHiddenIn(p, viewportWidth, contentMin, mode) ? 0 : p.sidebar.width);

/** The slot's width: the info panel its own; the tutor its own, narrowed down to 320 before the slot folds (spec 8.10). */
export function slotWidthFor(mode: InspectorMode, p: PanesState, viewportWidth: number, contentMin: number = CONTENT_MIN): number {
  if (mode === 'info') return p.inspector.width;
  return Math.max(TUTOR.min, Math.min(p.tutorWidth, mainColumnWidth(p, viewportWidth, contentMin, mode) - contentMin));
}

/**
 * Which panes are out of sight at this width. The sidebar keeps its own rule (it folds below its width + 520), and the
 * right panel folds whenever it does not fit beside the content column: so it always goes first. `inspectorPresent`:
 * the view has a right panel (the library with its table; spec §5.1). In tutor mode the panel narrows to 320 first, and a
 * tutor shown on demand pushes the sidebar away.
 */
export function hiddenPanes(p: PanesState, viewportWidth: number, inspectorPresent: boolean, contentMin: number = CONTENT_MIN, mode: InspectorMode = 'info'): { sidebar: boolean; inspector: boolean } {
  const inspector = !inspectorPresent || p.inspector.collapsed || (inspectorAutoCollapses(p, viewportWidth, contentMin, mode) && !p.inspector.forceShown);
  return { sidebar: sidebarHiddenIn(p, viewportWidth, contentMin, mode, inspectorPresent), inspector };
}

export function toggledSidebar(s: SidebarState, viewportWidth: number): SidebarState {
  if (sidebarHidden(s, viewportWidth)) return { ...s, collapsed: false, forceShown: autoCollapses(viewportWidth, s.width) };
  // Shown on demand in a narrow window: folding it again hands it back to the automatic fold, not a stored collapse (M-5).
  if (s.forceShown) return { ...s, forceShown: false };
  return { ...s, collapsed: true, forceShown: false };
}

/**
 * ⌃⌘S in the reader's tutor mode: the sidebar's rules, and the pane shown last wins. A sidebar brought back beside a tutor that
 * was shown on demand folds that tutor (it does not fit beside it); a sidebar the tutor had pushed away simply comes back.
 */
export function toggledSidebarWithTutor(p: PanesState, viewportWidth: number, mode: InspectorMode, contentMin: number = READER_CONTENT_MIN, inspectorPresent = true): PanesState {
  const pushedAway = mode === 'tutor' && sidebarHiddenIn(p, viewportWidth, contentMin, mode, inspectorPresent) && !sidebarHidden(p.sidebar, viewportWidth);
  const next: PanesState = pushedAway ? { ...p, inspector: { ...p.inspector, forceShown: false } } : { ...p, sidebar: toggledSidebar(p.sidebar, viewportWidth) };
  if (mode !== 'tutor' || !p.inspector.forceShown || next.inspector.forceShown === false || sidebarHidden(next.sidebar, viewportWidth)) return next;
  return inspectorAutoCollapses(next, viewportWidth, contentMin, mode) ? { ...next, inspector: { ...next.inspector, forceShown: false } } : next;
}

/** ⌥⌘I and the toolbar toggle, with the sidebar's rules: on demand in a narrow window, a stored choice otherwise. */
export function toggledInspector(p: PanesState, viewportWidth: number, contentMin: number = CONTENT_MIN, mode: InspectorMode = 'info'): PaneState {
  const i = p.inspector;
  if (hiddenPanes(p, viewportWidth, true, contentMin, mode).inspector) return { ...i, collapsed: false, forceShown: inspectorAutoCollapses(p, viewportWidth, contentMin, mode) };
  if (i.forceShown) return { ...i, forceShown: false };
  return { ...i, collapsed: true, forceShown: false };
}

export function afterViewportChange(s: SidebarState, viewportWidth: number): SidebarState {
  return s.forceShown && !autoCollapses(viewportWidth, s.width) ? { ...s, forceShown: false } : s;
}

export function inspectorAfterViewportChange(p: PanesState, viewportWidth: number, contentMin: number = CONTENT_MIN, mode: InspectorMode = 'info'): PaneState {
  return p.inspector.forceShown && !inspectorAutoCollapses(p, viewportWidth, contentMin, mode) ? { ...p.inspector, forceShown: false } : p.inspector;
}

/**
 * The width a drag of the right panel's boundary ends at: within its mode's range (260–480, tutor 320–560) and no wider than
 * leaves the content column its minimum — wider would fold the panel the moment it is let go. A panel shown on demand is
 * already past that rule.
 */
export function draggedInspectorWidth(p: PanesState, viewportWidth: number, px: number, contentMin: number = CONTENT_MIN, mode: InspectorMode = 'info'): number {
  const clamp = mode === 'tutor' ? clampTutor : clampInspector;
  return clamp(p.inspector.forceShown ? px : Math.min(px, mainColumnWidth(p, viewportWidth, contentMin, mode) - contentMin));
}

/** layout.panes → both panes; a key that is missing or not a number gives that pane's default (an M3 record has the sidebar only). */
export function parsePanes(raw: unknown): PanesState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (k: string): number | null => (typeof r[k] === 'number' ? (r[k] as number) : null);
  const sidebarWidth = num('sidebar');
  const inspectorWidth = num('inspector.info');
  const tutorWidth = num('inspector.tutor');
  return {
    sidebar: { width: sidebarWidth === null ? SIDEBAR.default : clampSidebar(sidebarWidth), collapsed: r['sidebarCollapsed'] === 1, forceShown: false },
    inspector: { width: inspectorWidth === null ? INSPECTOR.default : clampInspector(inspectorWidth), collapsed: r['inspectorCollapsed'] === 1, forceShown: false },
    tutorWidth: tutorWidth === null ? TUTOR.default : clampTutor(tutorWidth),
  };
}

/** The whole layout.panes record (settings.set replaces it whole): each mode's width under its own key. */
export const serializePanes = (p: PanesState): Record<string, number> => ({
  sidebar: p.sidebar.width,
  sidebarCollapsed: p.sidebar.collapsed ? 1 : 0,
  'inspector.info': p.inspector.width,
  'inspector.tutor': p.tutorWidth,
  inspectorCollapsed: p.inspector.collapsed ? 1 : 0,
});
