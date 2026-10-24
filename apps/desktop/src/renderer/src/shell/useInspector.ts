import { useCallback, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useShell } from '../state/shell-store';
import { lastInput } from '../ui/inputModality';
import { quietUntilInput } from '../ui/tooltipGate';
import { hiddenPanes, toggledInspector } from './layout';
import { useViewportWidth } from './useViewportWidth';

/** DOM id and test id of the toolbar toggle (inspector/InspectorToggle.tsx): where a fold hands a keyboard focus. */
export const INSPECTOR_TOGGLE_ID = 'inspector-toggle';

/** The item panel is out of sight: the view has none (`present` false), the user hid it, or the window is too narrow. */
export function useInspectorHidden(present: boolean): boolean {
  const sidebar = useShell((s) => s.sidebar);
  const inspector = useShell((s) => s.inspector);
  return hiddenPanes({ sidebar, inspector }, useViewportWidth(), present).inspector;
}

/** ⌥⌘I and the toolbar toggle (the registry handler), by the sidebar's rules (layout.ts toggledInspector). */
export function useToggleInspector(): () => void {
  return useCallback(() => {
    const { sidebar, inspector, setInspector } = useShell.getState();
    setInspector(toggledInspector({ sidebar, inspector }, innerWidth));
  }, []);
}

/**
 * Whatever folds the item panel — ⌥⌘I, its toggle, a drag or a key on its boundary, the window or the zoom — a focus
 * inside it does not fall to <body>: a keyboard user's goes to the toolbar toggle in the next frame (its ring and no
 * tooltip, as the sidebar's rescue does), a pointer user's is let go.
 */
export function useKeepFocusOnInspectorFold(hidden: boolean): void {
  const last = useRef(hidden);
  useLayoutEffect(() => {
    if (last.current === hidden) return;
    last.current = hidden;
    if (!hidden) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active.closest('#inspector, #inspector-separator') === null) return;
    if (lastInput() !== 'keyboard') {
      active.blur();
      return;
    }
    requestAnimationFrame(() => {
      const now = document.activeElement;
      // The user moved on within the frame (F6 right after the fold): the focus they placed stays.
      if (now instanceof HTMLElement && now !== document.body && now !== active && now.closest('[inert]') === null) return;
      const toggle = document.getElementById(INSPECTOR_TOGGLE_ID);
      if (!toggle) return;
      flushSync(() => quietUntilInput());
      toggle.focus();
    });
  }, [hidden]);
}

/** Shows the item panel if it is out of sight — folded by the user or by the window — as ⌥⌘I would (정보 편집 needs it). */
export function revealInspector(): void {
  const { sidebar, inspector, setInspector } = useShell.getState();
  const panes = { sidebar, inspector };
  if (hiddenPanes(panes, innerWidth, true).inspector) setInspector(toggledInspector(panes, innerWidth));
}
