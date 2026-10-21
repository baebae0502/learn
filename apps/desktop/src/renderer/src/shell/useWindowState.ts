import { useEffect } from 'react';
import type { LearnEventMap } from '@learn/domain';
import { api } from '../api';
import { useLearnEvent } from '../events';

const apply = ({ fullscreen, focused }: LearnEventMap['windowState']) => {
  const root = document.documentElement;
  root.toggleAttribute('data-fullscreen', fullscreen); // no traffic lights → no 84 px inset
  root.toggleAttribute('data-window-inactive', !focused); // selections fall back to the neutral fill
};

/** Initial state from ui.windowState() (M2), then main's windowState pushes. */
export function useWindowState(): void {
  useEffect(() => {
    void api().ui.windowState().then((r) => {
      if (r.ok) apply(r.data);
    });
  }, []);
  useLearnEvent('windowState', apply);
}
