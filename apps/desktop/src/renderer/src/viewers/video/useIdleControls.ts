import { useEffect, useState, type RefObject } from 'react';
import { VIDEO_TIMING } from '@learn/domain';

/**
 * On the stage a video that plays and has a still pointer hides its controls (spec 6.6). `active`: the stage is on and the video plays.
 * Pointer movement, a press or a key shows them again, and a pause or leaving the stage ends the hiding. They are not hidden while the
 * pointer rests on them or a menu of theirs is open: a bar that goes from under the pointer, or from under an open menu, is in the way.
 */
export function useIdleControls(reader: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    setIdle(false);
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = { x: NaN, y: NaN };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const bar = reader.current?.querySelector('.video-controls');
        if (bar?.matches(':hover') || document.querySelector('[role="menu"]')) arm();
        else setIdle(true);
      }, VIDEO_TIMING.controlsIdleMs);
    };
    const wake = () => {
      setIdle(false);
      arm();
    };
    const onMove = (e: PointerEvent) => {
      // A move the page makes itself (a layout shift under a still pointer) repeats the place: that is not the hand.
      if (e.screenX === last.x && e.screenY === last.y) return;
      last = { x: e.screenX, y: e.screenY };
      wake();
    };
    arm();
    addEventListener('pointermove', onMove, true);
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
    return () => {
      clearTimeout(timer);
      removeEventListener('pointermove', onMove, true);
      removeEventListener('pointerdown', wake, true);
      removeEventListener('keydown', wake, true);
    };
  }, [active, reader]);
  return idle;
}
