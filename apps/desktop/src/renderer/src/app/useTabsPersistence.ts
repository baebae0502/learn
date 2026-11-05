import { useEffect, useRef } from 'react';
import { api } from '../api';
import { useShell } from '../state/shell-store';
import { toSaved } from '../state/tabs';

const LATER_MS = 300;

/** Saves the open reader tabs and the shown one as ui.tabs, 300 ms after the last change and at once when the window unloads. */
export function useTabsPersistence(): void {
  const tabs = useShell((s) => s.tabs);
  const json = JSON.stringify(toSaved(tabs));
  // The boot value came from the setting itself; only a different record is written.
  const saved = useRef<string | null>(null);
  saved.current ??= json;
  const latest = useRef(json);
  latest.current = json;

  useEffect(() => {
    const write = (text: string) => {
      if (text === saved.current) return;
      saved.current = text;
      // A lost save only forgets these tabs; log the code only.
      api().settings.set({ key: 'ui.tabs', value: JSON.parse(text) }).then(
        (r) => {
          if (!r.ok) console.warn(`[tabs] saving ui.tabs failed: ${r.code}`);
        },
        () => console.warn('[tabs] saving ui.tabs failed: INTERNAL'),
      );
    };
    const timer = setTimeout(() => write(json), LATER_MS);
    const onUnload = () => write(latest.current);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [json]);
}
