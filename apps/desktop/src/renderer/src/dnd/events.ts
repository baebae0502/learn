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

/**
 * The window's drag bookkeeping (dragState.ts), written in the capture phase before any hook sees an event: Finder's files
 * and ⌥ for the drop targets that cannot read them; whether a native drag runs (React Aria reports a mouse drag's end early
 * when its source row leaves the page); and the end of a drag — on its drop (next tick, after the handlers) and on dragend,
 * which also sweeps the markers a cancelled drag left.
 */
export function installDndEvents(win: Window = window): () => void {
  const track = (e: DragEvent) => {
    dragState.setAlt(e.altKey);
    const files = e.dataTransfer?.types.includes('Files') ?? false;
    dragState.setFilesOver(files);
    if (files) dragState.end(); // Finder's files and a drag of ours never share the pointer
  };
  const started = (e: DragEvent) => {
    // A drag that React Aria turns into its own virtual one prevents the native drag, so it is not a native drag.
    setTimeout(() => dragState.setNative(!e.defaultPrevented), 0);
  };
  // The guard of a drop's focus move (dragState.armDropFocus) never outlives the user's next input.
  const input = () => {
    dragState.clearDropFocus();
    dragState.setPointerDrop(false);
  };
  const dropped = (e: DragEvent) => {
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
  win.addEventListener('dragstart', started, true);
  win.addEventListener('drop', dropped, true);
  win.addEventListener('dragend', ended, true);
  win.addEventListener('pointerdown', input, true);
  win.addEventListener('keydown', input, true);
  return () => {
    win.removeEventListener('dragenter', track, true);
    win.removeEventListener('dragover', track, true);
    win.removeEventListener('dragstart', started, true);
    win.removeEventListener('drop', dropped, true);
    win.removeEventListener('dragend', ended, true);
    win.removeEventListener('pointerdown', input, true);
    win.removeEventListener('keydown', input, true);
  };
}
