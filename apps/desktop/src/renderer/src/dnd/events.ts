import { dragState } from './dragState';

/**
 * Sends a dragleave to every element of each drop scope that is still marked. The hooks that mark a target count the elements the
 * drag entered and unmark it when each has left; a drag that ends without those events (esc under Playwright, a drag
 * cancelled in the middle) leaves the marker. A tree is one scope: its rows are told together.
 */
export function sweepDropMarks(doc: Document = document): void {
  const scopes = new Set([...doc.querySelectorAll('[data-drop-target]')].map((el) => el.closest('[role="treegrid"]') ?? el));
  for (const scope of scopes) for (const el of [scope, ...scope.querySelectorAll('*')]) el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
}

const LEAVE_GRACE_MS = 150;

/**
 * The window's drag bookkeeping (dragState.ts), written in the capture phase before any hook sees an event: Finder's files
 * and ⌥ for the drop targets that cannot read them; whether a native drag runs (React Aria reports a mouse drag's end early
 * when its source row leaves the page); and the end of a drag — on its drop (next tick, after the handlers) and on dragend,
 * which also sweeps the markers a cancelled drag left.
 */
export function installDndEvents(win: Window = window): () => void {
  const track = (e: DragEvent) => {
    stillIn();
    dragState.setAlt(e.altKey);
    const files = e.dataTransfer?.types.includes('Files') ?? false;
    dragState.setFilesOver(files);
    if (files) dragState.end(); // Finder's files and a drag of ours never share the pointer
  };
  const started = (e: DragEvent) => {
    // A drag that React Aria turns into its own virtual one prevents the native drag, so it is not a native drag.
    setTimeout(() => dragState.setNative(!e.defaultPrevented), 0);
  };
  // The guard of a drop's focus move (dragState.armDropFocus) never outlives the user's next input — a screen reader's click (no
  // pointer, no key) among them.
  const input = () => {
    if (dragState.get().kind === null) {
      dragState.clearDropFocus(); // a key of a keyboard drag is the drag's
      gone();
    }
    dragState.setPointerDrop(false);
  };
  // A native drag gives the page no pointer events, so a pointer that moves while Finder's files are still "over" means the drag
  // is gone and its cancel told the page nothing. Only then: pointer moves are the commonest event there is.
  const moved = () => {
    if (dragState.filesOver() && dragState.get().kind === null) gone();
  };
  // Finder's files have no dragend here, and a cancelled drag may send no dragleave: whatever is still marked has lost its drag.
  const gone = () => {
    clearTimeout(leaving);
    dragState.setFilesOver(false);
    sweepDropMarks();
  };
  // The drag leaves the window: a dragleave that names no element it goes to. Moving between elements sends a dragenter at once,
  // so the sweep waits for a moment in which none comes.
  let leaving: ReturnType<typeof setTimeout> | undefined;
  const left = (e: DragEvent) => {
    // The sweep's own dragleaves are untrusted and must not arm the wait again.
    if (!e.isTrusted || e.relatedTarget !== null || dragState.get().kind !== null) return;
    clearTimeout(leaving);
    leaving = setTimeout(gone, LEAVE_GRACE_MS);
  };
  const stillIn = () => clearTimeout(leaving);
  const dropped = (e: DragEvent) => {
    stillIn();
    dragState.setPointerDrop(true);
    dragState.setAlt(e.altKey);
    dragState.setNative(false);
    setTimeout(() => {
      dragState.setFilesOver(false);
      dragState.end();
    }, 0);
  };
  const ended = () => {
    dragState.setNative(false);
    dragState.setFilesOver(false);
    sweepDropMarks();
    dragState.end();
  };
  win.addEventListener('dragenter', track, true);
  win.addEventListener('dragover', track, true);
  win.addEventListener('dragleave', left, true);
  win.addEventListener('dragstart', started, true);
  win.addEventListener('drop', dropped, true);
  win.addEventListener('dragend', ended, true);
  win.addEventListener('pointerdown', input, true);
  win.addEventListener('pointermove', moved, true);
  win.addEventListener('keydown', input, true);
  win.addEventListener('click', input, true);
  return () => {
    win.removeEventListener('dragenter', track, true);
    win.removeEventListener('dragover', track, true);
    win.removeEventListener('dragleave', left, true);
    win.removeEventListener('dragstart', started, true);
    win.removeEventListener('drop', dropped, true);
    win.removeEventListener('dragend', ended, true);
    win.removeEventListener('pointerdown', input, true);
    win.removeEventListener('pointermove', moved, true);
    clearTimeout(leaving);
    win.removeEventListener('keydown', input, true);
    win.removeEventListener('click', input, true);
  };
}
