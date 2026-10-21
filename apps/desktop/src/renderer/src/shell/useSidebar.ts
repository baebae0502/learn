import { useCallback, useEffect, useRef } from 'react';
import { api } from '../api';
import { useShell } from '../state/shell-store';
import { serializePanes, sidebarHidden, toggledSidebar } from './layout';
import { useViewportWidth } from './useViewportWidth';

export function useSidebarHidden(): boolean {
  const sidebar = useShell((s) => s.sidebar);
  return sidebarHidden(sidebar, useViewportWidth());
}

export function useToggleSidebar(): () => void {
  return useCallback(() => {
    const { sidebar, setSidebar } = useShell.getState();
    setSidebar(toggledSidebar(sidebar, innerWidth));
  }, []);
}

/** Saves the width and the user's collapse choice (layout.panes) 300 ms after the last change. */
export function usePanePersistence(): void {
  const width = useShell((s) => s.sidebar.width);
  const collapsed = useShell((s) => s.sidebar.collapsed);
  // The boot value came from the setting itself; only a value that differs from the last one written is saved
  // (also when a change is undone within 300 ms, and under StrictMode's double effects).
  const saved = useRef<string | null>(null);
  saved.current ??= JSON.stringify(serializePanes({ width, collapsed, forceShown: false }));
  useEffect(() => {
    const value = serializePanes({ width, collapsed, forceShown: false });
    const json = JSON.stringify(value);
    if (json === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = json;
      // A lost save only forgets this layout; log the code only.
      api().settings.set({ key: 'layout.panes', value }).then(
        (r) => {
          if (!r.ok) console.warn(`[layout] saving layout.panes failed: ${r.code}`);
        },
        () => console.warn('[layout] saving layout.panes failed: INTERNAL'),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [width, collapsed]);
}
