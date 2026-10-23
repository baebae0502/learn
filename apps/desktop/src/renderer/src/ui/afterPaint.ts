/** A pending timer or frame callback, as its cancel. */
export type Pending = () => void;

/**
 * Runs `fn` once the next frame has been painted (the second animation frame from now). A countdown started there
 * cannot lose its time to a late first paint: the opening caption, sent while the renderer was still busy after
 * launch, painted 1.2 s late and stood 2.1 s of its 3.5 (Mac run 2, critique m2); the click ring on the PDF's next-page
 * press, whose page render held the frame, had faded before it was ever drawn (critique n3).
 */
export function afterPaint(fn: () => void, raf: (cb: () => void) => number = requestAnimationFrame, cancel: (id: number) => void = cancelAnimationFrame): Pending {
  let id = raf(() => {
    id = raf(fn);
  });
  return () => cancel(id);
}

/**
 * afterPaint, or after `fallbackMs` where no frames come (a hidden or minimised window draws none): whichever is
 * first, once.
 */
export function afterPaintOr(
  fallbackMs: number,
  fn: () => void,
  raf: (cb: () => void) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame,
): Pending {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    stop();
    clearTimeout(timer);
    fn();
  };
  const stop = afterPaint(once, raf, cancel);
  const timer = setTimeout(once, fallbackMs);
  return () => {
    done = true;
    stop();
    clearTimeout(timer);
  };
}
