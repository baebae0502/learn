import { useLayoutEffect } from 'react';
import { usePrefs } from '../data/queries';

/**
 * Main window only: the row height (density, design-spec 3.2: 24 / 28 / 32) and the UI text size (12–15 pt, every type
 * role scaled by --text-scale) on <html>, before paint and again on every prefsChanged. Until prefs are read the
 * stylesheet's defaults hold (regular, 13).
 */
export function useApplyPrefs(): void {
  const prefs = usePrefs().data;
  const density = prefs?.density;
  const fontSize = prefs?.fontSize;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (density) root.dataset['density'] = density;
    if (fontSize) root.dataset['fontSize'] = String(fontSize);
  }, [density, fontSize]);
}
