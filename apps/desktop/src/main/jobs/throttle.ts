/** A call made at most once per period: the first at once, then one at the end of the period for whatever came meanwhile. */
export interface Throttle {
  request(): void;
  /** A call that is waiting runs now (the end of a run); nothing when none waits. */
  flush(): void;
}

/** Progress notices and list announcements stay under their rate however fast the work reports (spec 3.3: ≤ 10 a second). */
export function createThrottle(fire: () => void, ms: number): Throttle {
  // The monotonic clock with sub-millisecond precision: a timer that fires a millisecond early, or a wall-clock reading
  // rounded down, would otherwise let an eleventh notice into a second.
  const now = (): number => performance.now();
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (): void => {
    clearTimeout(timer);
    timer = undefined;
    last = now(); // a request made while the notice is built waits for the period
    try {
      fire();
    } finally {
      // The period runs from the end of the notice: it is stamped as it leaves, somewhere in its run, so two sends are then
      // never closer than the period however long one took (a start-to-start period let ten gaps add up to under a second).
      last = now();
    }
  };
  const arm = (wait: number): void => {
    timer = setTimeout(() => {
      const early = last + ms - now();
      if (early > 0) arm(early);
      else run();
    }, wait);
  };
  return {
    request() {
      if (timer !== undefined) return;
      const wait = last + ms - now();
      if (wait <= 0) run();
      else arm(wait);
    },
    flush() {
      if (timer !== undefined) run();
    },
  };
}
