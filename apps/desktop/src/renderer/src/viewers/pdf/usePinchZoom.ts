import { useEffect, type RefObject } from 'react';
import { useReader } from './readerStore';
import { pinchScaleFactor } from './zoom';

/** Redrawing waits this long after the last pinch step, so the page is scaled by the browser meanwhile. */
const DRAWING_DELAY_MS = 400;

/**
 * A trackpad pinch reaches the page as a wheel event with ctrl held: the viewer zooms around the pointer (the browser's
 * own page zoom is not wanted). A plain wheel scrolls as before. The listener is not passive, since it must cancel the event.
 */
export function usePinchZoom(scrollRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const viewer = useReader.getState().handle?.viewer();
      if (!viewer) return;
      const scaleFactor = pinchScaleFactor(viewer.currentScale, e.deltaY);
      if (scaleFactor !== null) viewer.updateScale({ scaleFactor, origin: [e.clientX, e.clientY], drawingDelay: DRAWING_DELAY_MS });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollRef]);
}
