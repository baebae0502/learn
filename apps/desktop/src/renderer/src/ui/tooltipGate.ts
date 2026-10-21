import { useSyncExternalStore } from 'react';

/**
 * Tooltips never show while the window is inactive (another app, a sheet, the settings window) or while a native
 * menu is open: a macOS tooltip never outlives window deactivation or sits under a menu (Task 8 critique m1).
 */
type Reason = 'inactive' | 'menu';
const active = new Set<Reason>();
const listeners = new Set<() => void>();

export function setTooltipBlock(reason: Reason, on: boolean): void {
  if (on === active.has(reason)) return;
  if (on) active.add(reason);
  else active.delete(reason);
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
