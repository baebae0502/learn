import { useSyncExternalStore } from 'react';
import { isNavigationKey } from './inputModality';

/**
 * Tooltips never show while the window is inactive (another app, a sheet, the settings window), while a native
 * menu is open, or while an in-window modal (the ⌘K palette) is up: a macOS tooltip never outlives window
 * deactivation or sits under a menu or a palette (Task 8 critique m1; Task 9). Nor right after the app moved the
 * focus itself (`quiet`, quietUntilInput).
 */
type Reason = 'inactive' | 'menu' | 'modal' | 'quiet';
const active = new Set<Reason>();
const listeners = new Set<() => void>();

export function setTooltipBlock(reason: Reason, on: boolean): void {
  if (on === active.has(reason)) return;
  if (on) active.add(reason);
  else active.delete(reason);
  // Visible to tests and the evidence harness (which reason holds tooltips back).
  if (typeof document !== 'undefined') {
    if (active.size > 0) document.documentElement.dataset['tooltipBlock'] = [...active].sort().join(' ');
    else delete document.documentElement.dataset['tooltipBlock'];
  }
  for (const l of listeners) l();
}

export const tooltipsBlocked = (): boolean => active.size > 0;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTooltipsBlocked(): boolean {
  return useSyncExternalStore(subscribe, tooltipsBlocked);
}

let lift: (() => void) | null = null;

/**
 * The app is about to move the focus itself (the sidebar's focus rescue after ⌃⌘S, a fold, a drag): that focus keeps
 * its ring for a keyboard user but pops no tooltip, as a menu shortcut never does on the Mac (Mac run 39779536146,
 * critique m1: the toggle's tooltip stayed open over every later screen). The user's next navigation key or real
 * pointer input (a press, a move that moves) lifts it, so the tooltips come back with the next Tab or hover.
 */
export function quietUntilInput(doc: Document = document): void {
  setTooltipBlock('quiet', true);
  if (lift) return;
  const onKey = (e: KeyboardEvent) => {
    if (isNavigationKey(e)) done();
  };
  const onPointer = (e: PointerEvent) => {
    if (e.type === 'pointerdown' || e.movementX !== 0 || e.movementY !== 0) done();
  };
  const done = () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onPointer, true);
    doc.removeEventListener('pointermove', onPointer, true);
    lift = null;
    setTooltipBlock('quiet', false);
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);
  doc.addEventListener('pointermove', onPointer, true);
  lift = done;
}
