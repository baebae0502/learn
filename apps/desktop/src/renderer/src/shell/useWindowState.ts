import { useEffect, useRef } from 'react';
import type { LearnEventMap } from '@learn/domain';
import { api } from '../api';
import { useLearnEvent } from '../events';

const apply = ({ fullscreen, focused }: LearnEventMap['windowState']) => {
  const root = document.documentElement;
  root.toggleAttribute('data-fullscreen', fullscreen); // no traffic lights → no 84 px inset
  root.toggleAttribute('data-window-inactive', !focused); // selections fall back to the neutral fill
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
}
