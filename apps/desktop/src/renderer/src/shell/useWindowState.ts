import { useEffect, useRef } from 'react';
import type { LearnEventMap } from '@learn/domain';
import { api } from '../api';
import { useLearnEvent } from '../events';
import { setTooltipBlock } from '../ui/tooltipGate';

const apply = ({ fullscreen, focused, sheetOpen }: LearnEventMap['windowState']) => {
  const root = document.documentElement;
  root.toggleAttribute('data-fullscreen', fullscreen); // no traffic lights → no 84 px inset
  // Not key: no rings or keyboard cursor, neutral selection. Not main as well (no sheet of ours attached): the chrome
  // dims (design-spec 2.1).
  root.toggleAttribute('data-window-inactive', !focused);
  root.toggleAttribute('data-window-not-main', !focused && !sheetOpen);
  setTooltipBlock('inactive', !focused); // a sheet, another app or window: open tooltips close
};

/**
 * Initial state from ui.windowState() (M2), then main's windowState pushes. A push that lands before the initial
 * answer is newer than it: the answer is then dropped.
 */
export function useWindowState(): void {
  const pushed = useRef(false);
  useEffect(() => {
    void api()
      .ui.windowState()
      .then(
        (r) => {
          if (!r.ok) console.warn(`[window] reading the window state failed: ${r.code}`);
          else if (!pushed.current) apply(r.data);
        },
        () => console.warn('[window] reading the window state failed: INTERNAL'),
      );
  }, []);
  useLearnEvent('windowState', (state) => {
    pushed.current = true;
    apply(state);
  });
  // A menu-bar menu is open (macOS keeps the window key meanwhile): no tooltip under it.
  useLearnEvent('nativeMenu', ({ open }) => setTooltipBlock('menu', open));
  // A menu takes all input while it tracks: input reaching the page means none is open (a missed close never sticks).
  useEffect(() => {
    const menuClosed = () => setTooltipBlock('menu', false);
    for (const type of ['keydown', 'pointerdown'] as const) document.addEventListener(type, menuClosed, true);
    return () => {
      for (const type of ['keydown', 'pointerdown'] as const) document.removeEventListener(type, menuClosed, true);
    };
  }, []);
}
