/**
 * Calls `onChange` each time the display's pixel ratio changes (the window moved to another screen, or the screen's scale
 * was changed). A media query matches one ratio only, so it is armed again for the new one after every change.
 * Returns the stop function.
 */
export function watchDevicePixelRatio(onChange: () => void, win: Pick<Window, 'matchMedia' | 'devicePixelRatio'> = window): () => void {
  let query: MediaQueryList | null = null;
  let stopped = false;
  const listener = (): void => {
    if (stopped) return;
    onChange();
    arm();
  };
  const arm = (): void => {
    query?.removeEventListener('change', listener);
    query = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    query.addEventListener('change', listener, { once: true });
  };
  arm();
  return () => {
    stopped = true;
    query?.removeEventListener('change', listener);
  };
}
