import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryItem, ReadingLocator, ReadingPosition } from '@learn/domain';
import { api, ApiError, unwrap } from '../api';
import { createPositionSaver, type PositionSaver, type SavePolicy } from './positionSaver';

export interface LatestPosition {
  locator: ReadingLocator;
  progress: number | null;
}

export interface PositionHandle {
  /** false until the stored position (or its absence) is known. */
  loaded: boolean;
  saved: ReadingPosition | null;
  /** Saves are ignored until the caller has applied the restore (markRestored). */
  markRestored(initial: ReadingLocator): void;
  update(locator: ReadingLocator, progress: number | null): void;
  flush(): void;
}

const logFailure = (what: string, e: unknown) => {
  console.warn(`${what} failed`, e instanceof ApiError ? e.code : 'UNKNOWN');
};

/**
 * Records the open (reader.open, once per mount), loads the stored reading position and saves new ones.
 * Never saves before markRestored, so loading cannot overwrite the stored value with the default.
 * `readLatest` lets the viewer supply the exact final position, read just before the unmount flush.
 * The returned handle changes identity only when the item or the loaded position changes.
 */
export function usePosition(item: LibraryItem, policy: SavePolicy, readLatest?: () => LatestPosition | null): PositionHandle {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<ReadingPosition | null>(null);
  const saver = useRef<PositionSaver | null>(null);
  const policyRef = useRef(policy);
  const latestRef = useRef(readLatest);
  const itemId = item.id;
  const revisionId = item.revisionId;

  useEffect(() => {
    latestRef.current = readLatest;
  });

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSaved(null);
    unwrap(api().reader.getPosition({ itemId })).then(
      (p) => { if (!cancelled) { setSaved(p); setLoaded(true); } },
      (e: unknown) => { if (!cancelled) { logFailure('reader.getPosition', e); setLoaded(true); } },
    );
    // Independent of the load above (sent after it, so getPosition still sees what was stored before this open).
    unwrap(api().reader.open({ itemId })).catch((e: unknown) => logFailure('reader.open', e));
    return () => {
      cancelled = true;
      const s = saver.current;
      const latest = latestRef.current?.();
      if (s && latest) s.update(latest.locator, latest.progress);
      s?.flush();
      s?.dispose();
      saver.current = null;
    };
  }, [itemId]);

  useEffect(() => {
    const onUnload = () => saver.current?.flush();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const markRestored = useCallback((initial: ReadingLocator) => {
    saver.current?.flush();
    saver.current?.dispose();
    saver.current = createPositionSaver({
      policy: policyRef.current,
      initial,
      send: (locator, progress) => unwrap(api().reader.savePosition({ itemId, revisionId, locator, progress })),
      onError: (e) => logFailure('reader.savePosition', e),
    });
  }, [itemId, revisionId]);
  const update = useCallback((l: ReadingLocator, p: number | null) => saver.current?.update(l, p), []);
  const flush = useCallback(() => saver.current?.flush(), []);

  return useMemo(() => ({ loaded, saved, markRestored, update, flush }), [loaded, saved, markRestored, update, flush]);
}
