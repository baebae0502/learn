import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { api } from '../api';
import { lastInput } from '../ui/inputModality';
import { quietUntilInput } from '../ui/tooltipGate';
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
    if (!next) return;
    quietUntilInput(); // its ring, but no tooltip popping up on it (critique m1)
    next.focus();
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

/** Gone from the page, or under an inert ancestor: nothing can hold the focus there. */
const takenAway = (el: Element): boolean => !el.isConnected || el.closest('[inert]') !== null;

/**
 * Whatever folds or shows the sidebar — ⌃⌘S, a drag, or the window (or the zoom) changing its width so that it folds or
 * comes back by itself (design-spec 2.1, M-5) — the focus that it took along gets the same rescue (keepFocusAcross),
 * once the change is on screen. An inert sidebar may still hold the focus. A copy that unmounted has dropped it, maybe
 * a commit before the shell's: the toolbar sees the new width first when anything re-renders it.
 *
 * So an element a fold can take (takenByFold) that loses the focus to nowhere is a candidate, and it is judged after
 * the fact: kept only if it is then gone or inert, i.e. the change took it. The judgement runs once the task that
 * dropped the focus is over (a microtask), or in the fold's own commit when that came first. A row the user left —
 * a click on nothing, ⎋ — is still there and usable then, so a later fold never "rescues" it onto a toggle; nor is
 * the palette's field ever a candidate (Task 8 critique m1). Any focus that lands clears the memory. The commands
 * that know beforehand (useToggleSidebar, the separator) have rescued it already; a second rescue moves it to the
 * same place.
 */
export function useKeepFocusAcrossFold(hidden: boolean): void {
  /** The focus a change took (judged), kept until the shell's fold reads it or the focus lands anywhere. */
  const lost = useRef<Element | null>(null);
  /** Dropped to nowhere in the running task, not judged yet. */
  const dropped = useRef<Element | null>(null);
  useEffect(() => {
    let held: Element | null = null; // the focused element, when a fold can take it along (read while connected)
    const into = (e: FocusEvent) => {
      lost.current = null;
      dropped.current = null;
      held = e.target instanceof Element && takenByFold(e.target) ? e.target : null;
    };
    const out = (e: FocusEvent) => {
      const el = held;
      if (e.relatedTarget !== null || el === null || e.target !== el) return;
      dropped.current = el;
      queueMicrotask(() => {
        if (dropped.current !== el) return; // landed elsewhere, or already judged by the fold's commit
        dropped.current = null;
        if (takenAway(el)) lost.current = el;
      });
    };
    document.addEventListener('focusin', into, true);
    document.addEventListener('focusout', out, true);
    return () => {
      document.removeEventListener('focusin', into, true);
      document.removeEventListener('focusout', out, true);
    };
  }, []);
  const lastHidden = useRef(hidden);
  useLayoutEffect(() => {
    if (lastHidden.current === hidden) return;
    lastHidden.current = hidden;
    const active = document.activeElement;
    // After the change has applied: a candidate counts only if the change took it.
    const candidate = [dropped.current, lost.current].find((el) => el !== null && takenAway(el)) ?? null;
    lost.current = null;
    dropped.current = null;
    keepFocusAcross(hidden, active !== null && active !== document.body ? active : candidate);
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
