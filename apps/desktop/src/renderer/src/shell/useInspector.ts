import { useCallback, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useShell } from '../state/shell-store';
import { lastInput } from '../ui/inputModality';
import { quietUntilInput } from '../ui/tooltipGate';
import { hiddenPanes, inspectorContentMin, toggledInspector, type InspectorMode } from './layout';
import { chooseInspectorMode, inspectorModeNow, useInspectorMode } from './inspectorMode';
import { usePanelFocusRequest } from './panelFocus';
import { useViewportWidth } from './useViewportWidth';

/** DOM id and test id of the toolbar toggle (inspector/InspectorToggle.tsx): where a fold hands a keyboard focus. */
export const INSPECTOR_TOGGLE_ID = 'inspector-toggle';

/** The item panel is out of sight: the view has none (`present` false), the user hid it, or the window is too narrow. */
export function useInspectorHidden(present: boolean): boolean {
  const sidebar = useShell((s) => s.sidebar);
  const inspector = useShell((s) => s.inspector);
  const tutorWidth = useShell((s) => s.tutorWidth);
  const min = inspectorContentMin(useShell((s) => s.view.kind));
  return hiddenPanes({ sidebar, inspector, tutorWidth }, useViewportWidth(), present, min, useInspectorMode()).inspector;
}

/** ⌥⌘I and the toolbar toggle (the registry handler), by the sidebar's rules (layout.ts toggledInspector). */
export function useToggleInspector(): () => void {
  return useCallback(() => {
    const { sidebar, inspector, tutorWidth, setInspector, view } = useShell.getState();
    setInspector(toggledInspector({ sidebar, inspector, tutorWidth }, innerWidth, inspectorContentMin(view.kind), inspectorModeNow()));
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
export function revealInspector(mode: InspectorMode = inspectorModeNow()): void {
  const { sidebar, inspector, tutorWidth, setInspector, view } = useShell.getState();
  const panes = { sidebar, inspector, tutorWidth };
  const min = inspectorContentMin(view.kind);
  if (hiddenPanes(panes, innerWidth, true, min, mode).inspector) setInspector(toggledInspector(panes, innerWidth, min, mode));
}

/**
 * ⌃⌘1 / ⌃⌘2 (the registry handler): the choice is remembered, a folded panel opens, and the tutor takes the focus at its first control
 * (the input field, once the panel has one) — the focus is where F6 would land. The focus is a request the panel answers when it is
 * on screen (Inspector, useFocusRequest), not a wait of the handler's.
 */
export function showInspectorMode(mode: InspectorMode): void {
  chooseInspectorMode(mode);
  revealInspector(mode);
  if (mode === 'tutor') usePanelFocusRequest.getState().request();
  else usePanelFocusRequest.getState().done();
}
