import { useEffect, type RefObject } from 'react';

/** How far a toast stands in from the stage's top and right edges (design-spec 6 토스트: 16, as everywhere). */
const INSET_PX = 16; // local: the toast's own 16 (--space-16) as the number the measure needs

/**
 * While a video reader is the shown view its toasts stand at the stage's top right (spec 12, owner decision 2026-11-26): not over the
 * controls and not over the subtitle. The region is drawn in the body, so the stage's corner is measured and given to toast.css as
 * variables under `data-video-toasts`; it follows the stage when the panes, the strip or the stage mode move it.
 */
export function useStageToasts(stage: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const box = stage.current;
    if (!active || !box) return;
    const root = document.documentElement;
    const place = () => {
      const r = box.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      root.style.setProperty('--toast-stage-top', `${Math.round(r.top) + INSET_PX}px`);
      root.style.setProperty('--toast-stage-right', `${Math.round(root.clientWidth - r.right) + INSET_PX}px`);
      root.setAttribute('data-video-toasts', '');
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    addEventListener('resize', place);
    return () => {
      observer.disconnect();
      removeEventListener('resize', place);
      root.removeAttribute('data-video-toasts');
      root.style.removeProperty('--toast-stage-top');
      root.style.removeProperty('--toast-stage-right');
    };
  }, [stage, active]);
}
