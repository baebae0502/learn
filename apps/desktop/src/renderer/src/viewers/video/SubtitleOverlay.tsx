import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
import type { Cue } from '@learn/domain';
import { useReaderScope } from '../readerScope';
import { activeCues, indexCues } from './activeCues';
import { pictureRect, type Rect } from './pictureRect';
import { useVideo } from './videoStore';

const NONE: readonly number[] = [];
const sameList = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** The picture's rectangle in the stage (P-24): measured with the stage's size and the video's own size, again when either changes. */
function usePictureRect(stage: RefObject<HTMLElement | null>, video: RefObject<HTMLVideoElement | null>): { rect: Rect; bottom: number } | null {
  const [drawn, setDrawn] = useState<{ rect: Rect; bottom: number } | null>(null);
  useEffect(() => {
    const box = stage.current;
    const v = video.current;
    if (!box || !v) return;
    const measure = () => {
      // A tab that is not shown reads a box of 0: nothing is drawn, and the next real size draws it.
      const rect = pictureRect({ width: box.clientWidth, height: box.clientHeight }, { width: v.videoWidth, height: v.videoHeight });
      const next = rect && { rect, bottom: box.clientHeight - rect.top - rect.height };
      setDrawn((prev) => (prev && next && prev.bottom === next.bottom && prev.rect.left === next.rect.left && prev.rect.top === next.rect.top && prev.rect.width === next.rect.width && prev.rect.height === next.rect.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    v.addEventListener('loadedmetadata', measure);
    v.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      v.removeEventListener('loadedmetadata', measure);
      v.removeEventListener('resize', measure);
    };
  }, [stage, video]);
  return drawn;
}

/**
 * The subtitle (spec 6.4): the cues on at the playhead, stacked in start order, in a box over the drawn picture's lower part. The playhead is
 * the store's time, which the reader feeds from every shown frame while it plays and from `seeked` when it is paused or moved, so a cue
 * changes within a frame; the state changes only when the set of cues does. Cue text is drawn as text nodes and nothing else.
 */
export function SubtitleOverlay({ stage, video, cues }: { stage: RefObject<HTMLElement | null>; video: RefObject<HTMLVideoElement | null>; cues: readonly Cue[] | undefined }) {
  const store = useReaderScope().video;
  const on = useVideo((s) => s.trackId !== null && s.captionsOn);
  const index = useMemo(() => (cues ? indexCues(cues) : null), [cues]);
  const drawn = usePictureRect(stage, video);
  const [active, setActive] = useState<readonly number[]>(NONE);

  useEffect(() => {
    if (!index || !on) {
      setActive(NONE);
      return;
    }
    const sync = () => {
      const next = activeCues(index, store.getState().timeMs);
      setActive((prev) => (sameList(prev, next) ? prev : next));
    };
    sync();
    return store.subscribe(sync);
  }, [index, on, store]);

  const lines = index ? active.map((i) => index.cues[i]!.text) : [];
  const text = lines.length > 0 ? lines.join('\n') : null;
  useEffect(() => {
    store.getState().patch({ cueText: text });
  }, [text, store]);

  if (!drawn) return null;
  const { rect, bottom } = drawn;
  const style = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, '--pic-lb': `${bottom}px` } as CSSProperties;
  return (
    <div className="subtitle-box" style={style} data-testid="subtitle-box" aria-hidden="true">
      {lines.length > 0 && (
        <div className="subtitle" data-testid="subtitle-overlay">
          {lines.map((line, i) => (
            <div key={active[i]} className="sub-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
