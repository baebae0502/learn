import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { api } from '../api';
import { lastInput } from '../ui/inputModality';
import { useShell } from '../state/shell-store';
import { serializePanes, sidebarHidden, toggledSidebar } from './layout';
import { useViewportWidth } from './useViewportWidth';

export function useSidebarHidden(): boolean {
  const sidebar = useShell((s) => s.sidebar);
  return sidebarHidden(sidebar, useViewportWidth());
}

/** DOM ids of the two copies of the toggle (SidebarToggle): the one in the sidebar top and the one in the toolbar. */
export const TOGGLE_IDS = { sidebar: 'sidebar-toggle', toolbar: 'toolbar-sidebar-toggle' } as const;

/**
 * Focus must not fall to <body> with the element that holds it: hiding makes the sidebar (and the separator) inert or
 * gone, showing unmounts the toolbar's toggle and ⌘K launcher. Read before the change (`from`: the element that held
 * the focus, when the change has already taken it away); for a keyboard user the copy
 * that takes over gets the focus (and its ring and tooltip): the other launcher for a launcher, else the other toggle.
 * Otherwise — the pointer was last used, or nothing yet (focus that the window gave on activation) — the focus is let
 * go: a menu or shortcut toggle never pops a ring or a tooltip on the toggle (Task 8 critique m1).
 */
export function keepFocusAcross(willHide: boolean, from: Element | null = document.activeElement): void {
  const active = from;
  if (!(active instanceof HTMLElement) || active === document.body) return;
  const launcher = active.matches('.launcher');
  // An element already gone (a copy unmounted by the change, useKeepFocusAcrossFold) left with the change.
  const leaving =
    !active.isConnected ||
    (willHide
      ? Boolean(document.querySelector('.sidebar-inner')?.contains(active)) || active.closest('.pane-separator') !== null
      : active.id === TOGGLE_IDS.toolbar || (launcher && active.closest('.titlebar') !== null));
  if (!leaving) return;
  if (lastInput() !== 'keyboard') {
    active.blur();
    return;
  }
  requestAnimationFrame(() => {
    // The user moved on within the frame (F6 right after the fold, Task 12): the focus they placed stays.
    const now = document.activeElement;
    if (now instanceof HTMLElement && now !== document.body && now !== active && now.closest('[inert]') === null) return;
    const next = launcher
      ? document.querySelector<HTMLElement>(`${willHide ? '.titlebar' : '.sidebar-inner'} .launcher`)
      : document.getElementById(willHide ? TOGGLE_IDS.toolbar : TOGGLE_IDS.sidebar);
    next?.focus();
  });
}

export function useToggleSidebar(): () => void {
  return useCallback(() => {
    const { sidebar, setSidebar } = useShell.getState();
    const next = toggledSidebar(sidebar, innerWidth);
    const willHide = sidebarHidden(next, innerWidth);
    if (willHide !== sidebarHidden(sidebar, innerWidth)) keepFocusAcross(willHide);
    setSidebar(next);
  }, []);
}

/** Whether folding or showing the sidebar can take this element away: the sidebar's contents, or the toolbar copies. */
const takenByFold = (el: Element): boolean =>
  el.closest('.sidebar-inner, .pane-separator') !== null || el.id === TOGGLE_IDS.toolbar || (el.matches('.launcher') && el.closest('.titlebar') !== null);

/**
 * Whatever folds or shows the sidebar — ⌃⌘S, a drag, or the window (or the zoom) changing its width so that it folds or
 * comes back by itself (design-spec 2.1, M-5) — the focus that it took along gets the same rescue (keepFocusAcross),
 * once the change is on screen. An inert sidebar may still hold the focus. A copy that unmounted has dropped it, and
 * maybe a commit earlier: the toolbar re-renders with the new width before the shell does when anything re-renders it
 * first. So the last element a fold can take that lost the focus to nowhere, and is gone or inert, is remembered until
 * the focus lands anywhere. Nothing else is: the palette's field, gone as the palette closed, is never "rescued" onto
 * a toggle (Task 8 critique m1). The commands that know beforehand (useToggleSidebar, the separator) have rescued it
 * already; a second rescue moves it to the same place.
 */
export function useKeepFocusAcrossFold(hidden: boolean): void {
  const lost = useRef<Element | null>(null);
  useEffect(() => {
    let held: Element | null = null; // the focused element, when a fold can take it along (read while connected)
    const into = (e: FocusEvent) => {
      lost.current = null;
      held = e.target instanceof Element && takenByFold(e.target) ? e.target : null;
    };
    const out = (e: FocusEvent) => {
      if (e.relatedTarget === null && e.target === held) lost.current = held;
    };
    document.addEventListener('focusin', into, true);
    document.addEventListener('focusout', out, true);
    return () => {
      document.removeEventListener('focusin', into, true);
      document.removeEventListener('focusout', out, true);
    };
  }, []);
  const shown = useRef(hidden);
  useLayoutEffect(() => {
    if (shown.current === hidden) return;
    shown.current = hidden;
    const active = document.activeElement;
    const gone = lost.current !== null && (!lost.current.isConnected || lost.current.closest('[inert]') !== null) ? lost.current : null;
    lost.current = null;
    keepFocusAcross(hidden, active !== null && active !== document.body ? active : gone);
  }, [hidden]);
}

/** Saves the width and the user's collapse choice (layout.panes) 300 ms after the last change. */
export function usePanePersistence(): void {
  const width = useShell((s) => s.sidebar.width);
  const collapsed = useShell((s) => s.sidebar.collapsed);
  // The boot value came from the setting itself; only a value that differs from the last one written is saved
  // (also when a change is undone within 300 ms, and under StrictMode's double effects).
  const saved = useRef<string | null>(null);
  saved.current ??= JSON.stringify(serializePanes({ width, collapsed, forceShown: false }));
  useEffect(() => {
    const value = serializePanes({ width, collapsed, forceShown: false });
    const json = JSON.stringify(value);
    if (json === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = json;
      // A lost save only forgets this layout; log the code only.
      api().settings.set({ key: 'layout.panes', value }).then(
        (r) => {
          if (!r.ok) console.warn(`[layout] saving layout.panes failed: ${r.code}`);
        },
        () => console.warn('[layout] saving layout.panes failed: INTERNAL'),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [width, collapsed]);
}
