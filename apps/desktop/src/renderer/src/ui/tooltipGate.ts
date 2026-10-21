import { useSyncExternalStore } from 'react';

/**
 * Tooltips never show while the window is inactive (another app, a sheet, the settings window), while a native
 * menu is open, or while an in-window modal (the ⌘K palette) is up: a macOS tooltip never outlives window
 * deactivation or sits under a menu or a palette (Task 8 critique m1; Task 9).
 */
type Reason = 'inactive' | 'menu' | 'modal';
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
