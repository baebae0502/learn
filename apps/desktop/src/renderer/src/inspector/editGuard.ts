/**
 * The open 정보 편집, as the rest of the window sees it (spec §5.3): whatever leaves the item — another row, the reader —
 * asks it first and goes on only if it let go. Closing the window and quitting ask too, from main (M/edit-flush.ts):
 * main runs the page's `__learnFlushEdits` before either. One editor at a time (InfoEditor registers).
 */
export interface EditSession {
  itemId: string;
  /** Changes that saving would write. */
  dirty(): boolean;
  /** No change: ends. Valid changes: saves, then ends. Invalid ones, or a failed save: stays. True when the caller may go on. */
  leave(): Promise<boolean>;
}

/** What main's flush gets back (the same three words as M/edit-flush.ts FlushResult). */
export type FlushResult = 'saved' | 'clean' | 'invalid';
/** The page's global main reaches with executeJavaScript (no IPC channel): present only while an editor is open. */
const host = globalThis as { __learnFlushEdits?: () => Promise<FlushResult> };

let session: EditSession | null = null;
let leaving: Promise<boolean> | null = null;

/** The editor's registration; the returned function ends it (a stale one never ends a newer session). */
export function openEditSession(s: EditSession): () => void {
  session = s;
  host.__learnFlushEdits = flushEdits;
  return () => {
    if (session !== s) return;
    session = null;
    delete host.__learnFlushEdits;
  };
}

export const editSession = (): EditSession | null => session;

/** Asks the open editor to let go; callers that come while it decides share one answer. */
export function leaveEditing(): Promise<boolean> {
  const s = session;
  if (!s) return Promise.resolve(true);
  leaving ??= s.leave().finally(() => {
    leaving = null;
  });
  return leaving;
}

/** Runs `run` now with no editor open, else once the editor let go (never if it stayed). */
export function afterEditing(run: () => void): void {
  if (!session) {
    run();
    return;
  }
  void leaveEditing().then((ok) => {
    if (ok) run();
  });
}

/** The window is about to close or the app to quit (main asks): the edit lets go if it can, and says how. */
export function flushEdits(): Promise<FlushResult> {
  const s = session;
  if (!s) return Promise.resolve('clean');
  const changed = s.dirty();
  // A leave that rejects did not let go: the window stays (main would read a rejected page call as nothing to save).
  return leaveEditing().then(
    (ok): FlushResult => (!ok ? 'invalid' : changed ? 'saved' : 'clean'),
    (): FlushResult => 'invalid',
  );
}
