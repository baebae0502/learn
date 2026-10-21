import type { WebContents } from 'electron';

/**
 * Natural height (CSS px, rounded up) of the first element matching `selector` in a not-yet-shown window.
 * Polls with timers (hidden windows get no animation frames); 0 → `fallback`.
 */
export async function contentHeight(contents: WebContents, selector: string, fallback = 240, timeoutMs = 5000): Promise<number> {
  const script = `new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const h = el ? el.getBoundingClientRect().height : 0;
      if (h > 0) resolve(Math.ceil(h));
      else if (Date.now() - started > ${timeoutMs}) resolve(0);
      else setTimeout(tick, 16);
    };
    tick();
  })`;
  const height = Number(await contents.executeJavaScript(script, true));
  return height > 0 ? height : fallback;
}

/** After sizing: the page may now cap itself to the window and scroll inside (CSS :root[data-sized]). */
export async function markSized(contents: WebContents): Promise<void> {
  await contents.executeJavaScript("document.documentElement.dataset.sized = '1'", true);
}
