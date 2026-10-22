import type { WebContents } from 'electron';

/**
 * A second measurement's limit, once the page has rendered and its font has loaded (it answers at once): a page that
 * never renders keeps the first measurement's height and is shown within that one's timeout.
 */
export const REMEASURE_MS = 500;

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

/**
 * Waits, at most `capMs`, for the fonts the first element matching `selector` is drawn with. Call it once the element
 * has rendered: laying it out requests exactly the faces its text needs (Pretendard on Linux; none on a Mac, where the
 * system fonts come first in the stack), and `document.fonts.ready` then waits for those loads only. A window shown
 * before this draws its boxes with no text for a moment (Pretendard, T13-m6); a font that never loads must not keep a
 * window hidden. True when the fonts were ready in time.
 */
export async function fontsReady(contents: WebContents, selector: string, capMs = 300): Promise<boolean> {
  const script = `(async () => {
    void (document.querySelector(${JSON.stringify(selector)}) ?? document.body).offsetHeight; // laid out: its faces requested
    await document.fonts.ready;
    return true;
  })()`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), capMs);
  });
  const ready = contents.executeJavaScript(script, true).then(
    (value) => value === true,
    () => false,
  );
  try {
    return await Promise.race([ready, cap]);
  } finally {
    clearTimeout(timer);
  }
}

/** After sizing: the page may now cap itself to the window and scroll inside (CSS :root[data-sized]). */
export async function markSized(contents: WebContents): Promise<void> {
  await contents.executeJavaScript("document.documentElement.dataset.sized = '1'", true);
}

/**
 * Calls `onHeight` with the natural height (CSS px, rounded up) of the first element matching `selector` whenever it
 * differs from `known` — a ResizeObserver in the page answers one pending call per change — until the page goes away.
 * The settings window grows and shrinks with a message that appears in it (it cannot be resized by hand).
 */
export function followContentHeight(contents: WebContents, selector: string, known: number, onHeight: (height: number) => void): void {
  if (contents.isDestroyed()) return;
  const script = `new Promise((resolve) => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return resolve(0);
    // The first notification comes at once with the current size, so a change made before this call is not missed.
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== ${known}) {
        ro.disconnect();
        resolve(h);
      }
    });
    ro.observe(el);
  })`;
  contents.executeJavaScript(script, true).then(
    (value) => {
      const height = Number(value);
      if (contents.isDestroyed() || !(height > 0) || height === known) return; // gone, or nothing to follow
      onHeight(height);
      followContentHeight(contents, selector, height, onHeight);
    },
    () => {}, // the page went away mid-call
  );
}
