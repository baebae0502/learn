// macOS demo: a shortcut through System Events, with the menu item as its fallback (Task 13 fix round 3 m2, residual
// polish re-review minor 1). Pure: everything it touches is passed in, so the unit test can play the late key.

export interface KeyPress {
  /** The real key (System Events). Throws NotPermitted when macOS refuses it, anything else when it fails or times out. */
  native(): Promise<unknown>;
  /** The same command from its menu item, idempotent: it brings about the chapter's state, never toggles past it. */
  fallback(): Promise<unknown>;
  /** Whether the state the key brings about is there now (a late key may have brought it already). */
  landed?(): Promise<boolean>;
  /**
   * After a fallback, whether the state still holds once a late key had time to land (about 2 s later), and how to
   * bring it back if that key undid it.
   */
  settle?: { holds(): Promise<boolean>; restore(): Promise<unknown> };
  /** Names the key in a note: "control+command+s". */
  name: string;
  isNotPermitted(e: unknown): boolean;
  note(text: string): void;
  sleep(ms: number): Promise<void>;
  errorText(e: unknown): string;
}

/** How long a refused or stuck key is given to land late, before the menu item runs. */
export const LATE_KEY_MS = 1000;
/** How long after a fallback the state is checked again, against a key that lands later still. */
export const SETTLE_MS = 2000;

/** Runs the key; on failure the idempotent fallback, guarded against a late key both before and after. */
export async function pressKey(k: KeyPress): Promise<'native' | 'late' | 'menu'> {
  try {
    await k.native();
    return 'native';
  } catch (e) {
    if (k.isNotPermitted(e)) {
      // Refused outright: nothing was queued, so nothing can land late.
      k.note(`System Events refused ${k.name} (${k.errorText(e)}): the menu item instead`);
      await k.fallback();
      return 'menu';
    }
    k.note(`${k.name} through System Events failed (${k.errorText(e)}): the menu item instead`);
  }
  await k.sleep(LATE_KEY_MS);
  if (k.landed && (await k.landed().catch(() => false))) {
    k.note(`${k.name} had landed late: not run again`);
    return 'late';
  }
  await k.fallback();
  if (k.settle) {
    await k.sleep(SETTLE_MS);
    if (!(await k.settle.holds().catch(() => false))) {
      k.note(`${k.name} landed after its menu item and undid it: the state was put back`);
      await k.settle.restore();
    }
  }
  return 'menu';
}
