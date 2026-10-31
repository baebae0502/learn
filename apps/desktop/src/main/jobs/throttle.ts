/** A call made at most once per period: the first at once, then one at the end of the period for whatever came meanwhile. */
export interface Throttle {
  request(): void;
  /** A call that is waiting runs now (the end of a run); nothing when none waits. */
  flush(): void;
}

/** Progress notices and list announcements stay under their rate however fast the work reports (spec 3.3: ≤ 10 a second). */
export function createThrottle(fire: () => void, ms: number): Throttle {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (): void => {
    clearTimeout(timer);
    timer = undefined;
    last = Date.now();
    fire();
  };
  return {
    request() {
      if (timer !== undefined) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    flush() {
      if (timer !== undefined) run();
    },
  };
}
