import { create } from 'zustand';
import { TUTOR_LIMITS, type SessionSummary } from '@learn/domain';

/** A name as the database keeps it: normalized and trimmed, so the count is the same. */
const clean = (raw: string): string => raw.normalize('NFC').trim();

/** Whether the name typed so far is over the limit (the field's note). */
export const titleTooLong = (raw: string): boolean => clean(raw).length > TUTOR_LIMITS.sessionTitle;

/**
 * What a finished name field asks of sessions:rename (spec 8.9): the new name; null — the first question again — when it was emptied;
 * nothing when the session keeps the name it has; a refusal over 200 characters.
 */
export function renamedTitle(raw: string, session: SessionSummary): { title: string | null } | 'unchanged' | 'tooLong' {
  const title = clean(raw);
  if (title.length > TUTOR_LIMITS.sessionTitle) return 'tooLong';
  if (title === '') return session.renamed ? { title: null } : 'unchanged';
  return title === session.title ? 'unchanged' : { title };
}

/**
 * The session row being named in place (one at a time, in whichever list shows it), the text typed so far, whether the rename is
 * on its way, and the row the focus goes back to once the edit ends (or a delete took the one it was on).
 */
interface SessionEdit {
  renaming: string | null;
  text: string;
  busy: boolean;
  /** The row to take the focus, once it is drawn. */
  focusRow: string | null;
  begin(conversationId: string): void;
  setText(text: string): void;
  setBusy(busy: boolean): void;
  /** `refocus`: the focus goes back to the row (↩, esc); a click elsewhere keeps it where it went. */
  end(refocus: boolean): void;
  focus(conversationId: string | null): void;
  /** A list that goes ends an edit of one of its rows (no row to give the focus back to). */
  releaseRows(conversationIds: readonly string[]): void;
}

export const useSessionEdit = create<SessionEdit>()((set, get) => ({
  renaming: null,
  text: '',
  busy: false,
  focusRow: null,
  begin: (renaming) => set({ renaming, text: '', busy: false }),
  setText: (text) => set({ text }),
  setBusy: (busy) => set({ busy }),
  end: (refocus) => set({ renaming: null, text: '', busy: false, focusRow: refocus ? get().renaming : null }),
  focus: (focusRow) => set({ focusRow }),
  releaseRows: (ids) => {
    const { renaming } = get();
    if (renaming !== null && ids.includes(renaming)) set({ renaming: null, text: '', busy: false, focusRow: null });
  },
}));
