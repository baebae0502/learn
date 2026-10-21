import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  addEventListener('resize', cb);
  return () => removeEventListener('resize', cb);
};

/** CSS px width of the window (zoom-aware), re-rendering on resize. */
export const useViewportWidth = (): number => useSyncExternalStore(subscribe, () => innerWidth);
