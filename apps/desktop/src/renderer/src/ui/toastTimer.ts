/**
 * The 5 s of a toast that closes by itself (design-spec 6 토스트), counted only while nothing holds it (the pointer on
 * the toasts, or the focus in them). Our own, not RAC's toast Timer (react-stately 3.51 / RAC 1.22.1), which has two
 * faults (Mac run 2, run 39884763777: the drop's "자료 8개를 가져왔습니다" stayed through the whole demo):
 * - a pause that lands after the deadline but before the timer's task has run (an input event runs first: Chromium
 *   gives input priority over timers) subtracts past zero and clears the timeout; resume() then does nothing, so the
 *   toast never closes;
 * - resume() on a running timer starts a second timeout and forgets the first, which still fires: a toast can close
 *   while the pointer rests on it.
 * Here a hold that finds the time already up closes the toast at once, and run() on a running timer does nothing.
 */
export class DismissTimer {
  private left: number;
  private since = 0;
  private handle: ReturnType<typeof setTimeout> | null = null;
  private done = false;

  constructor(
    ms: number,
    private readonly onDone: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.left = ms;
  }

  /** Counts down (again); nothing when it is counting already or has ended. */
  run(): void {
    if (this.done || this.handle !== null) return;
    if (this.left <= 0) return this.finish();
    this.since = this.now();
    this.handle = setTimeout(() => this.finish(), this.left);
  }

  /** Stops counting and keeps what is left; when the time is already up, it ends now. */
  hold(): void {
    if (this.done || this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
    this.left -= this.now() - this.since;
    if (this.left <= 0) this.finish();
  }

  /** Ends without calling back (the toast left the page). */
  stop(): void {
    this.done = true;
    if (this.handle !== null) clearTimeout(this.handle);
    this.handle = null;
  }

  get ended(): boolean {
    return this.done;
  }

  private finish(): void {
    if (this.done) return;
    this.stop();
    this.onDone();
  }
}
