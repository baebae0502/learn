import { useEffect, useRef, useState } from 'react';
import type { LibraryItem, ReadingLocator, ReadingPosition } from '@learn/domain';
import { api, ApiError, unwrap } from '../api';
import { createPositionSaver, type PositionSaver, type SavePolicy } from './positionSaver';

export interface PositionHandle {
  /** false until the stored position (or its absence) is known. */
  loaded: boolean;
  saved: ReadingPosition | null;
  /** Saves are ignored until the caller has applied the restore (markRestored). */
  markRestored(initial: ReadingLocator): void;
  update(locator: ReadingLocator, progress: number | null): void;
  flush(): void;
}

const logFailure = (e: unknown) => {
  console.warn('reader.savePosition failed', e instanceof ApiError ? e.code : 'UNKNOWN');
};

/**
 * Loads the stored reading position (getPosition also marks the item opened in main) and saves new ones.
 * Never saves before markRestored, so loading cannot overwrite the stored value with the default.
 */
export function usePosition(item: LibraryItem, policy: SavePolicy): PositionHandle {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<ReadingPosition | null>(null);
  const saver = useRef<PositionSaver | null>(null);
  const policyRef = useRef(policy);
  const itemId = item.id;
  const revisionId = item.revisionId;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSaved(null);
    unwrap(api().reader.getPosition({ itemId })).then(
      (p) => { if (!cancelled) { setSaved(p); setLoaded(true); } },
      (e: unknown) => { if (!cancelled) { logFailure(e); setLoaded(true); } },
    );
    return () => {
      cancelled = true;
      saver.current?.flush();
      saver.current?.dispose();
      saver.current = null;
    };
  }, [itemId]);

  useEffect(() => {
    const onUnload = () => saver.current?.flush();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Stable identity per item: callers use these in effects.
  const handle = useRef<PositionHandle | null>(null);
  const markRestored = (initial: ReadingLocator) => {
    saver.current?.dispose();
    saver.current = createPositionSaver({
      policy: policyRef.current,
      initial,
      send: (locator, progress) => unwrap(api().reader.savePosition({ itemId, revisionId, locator, progress })),
      onError: logFailure,
    });
  };
  handle.current = {
    loaded,
    saved,
    markRestored,
    update: (l, p) => saver.current?.update(l, p),
    flush: () => saver.current?.flush(),
  };
  return handle.current;
}
