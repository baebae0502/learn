/** Where the conversation column is now, as the owed focus reads it. */
export interface LogFocusState {
  /** The tab's store still owes the column the focus. */
  owed: boolean;
  /** The thread is on screen. */
  drawn: boolean;
  /** The panel can be seen. */
  visible: boolean;
  /** The thread's read failed. */
  failed: boolean;
}

/**
 * The focus owed to the conversation column after a session row's click opened the folded panel and folded the sidebar that held the
 * row: taken once the column is drawn and can be seen. It belongs to that press alone, so it is let go when the thread's read fails or
 * when the panel, once seen, is folded again before the column is drawn — a conversation drawn later never takes the focus unasked.
 * `take` and `drop` both end it: the caller clears the store, and the next `owed: false` forgets what this press saw.
 */
export function createLogFocus(): { step(s: LogFocusState): 'take' | 'drop' | 'wait' | 'none' } {
  let seen = false;
  return {
    step({ owed, drawn, visible, failed }) {
      if (!owed) {
        seen = false;
        return 'none';
      }
      if (failed) return 'drop';
      if (visible) {
        seen = true;
        return drawn ? 'take' : 'wait';
      }
      return seen ? 'drop' : 'wait';
    },
  };
}
