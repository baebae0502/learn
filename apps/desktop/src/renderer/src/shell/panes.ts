// F6 order (design-spec 7.4, 8.3): sidebar → table → item panel. The toast region (ui/toasts.tsx, data-pane="toasts")
// exists only while a toast is visible; it is the last stop so F6 still reaches a toast once the keymap owns F6.
const PANES = ['sidebar', 'content', 'inspector', 'toasts'] as const;
/**
 * Where F6 lands in a pane: its first control that does something and can take the focus now. A control disabled with
 * a reason (ui/disabledReason.tsx) stays a Tab stop for its tooltip, but F6 goes past it (이전 쪽 on page 1); the
 * player is a control (the video reader); a hidden one (the player behind the codec notice) is passed over.
 */
const FOCUSABLE =
  'button:not([disabled]):not([aria-disabled="true"]), [href], input:not([disabled]), select:not([disabled]), video[controls], [tabindex="0"]:not([aria-disabled="true"]), [role="option"]';

/**
 * A grid (the library table, and the sidebar's tree) is one stop with a roving focus: F6 lands on its stop row (tabindex 0: the cursor, or the
 * first row before there is one), never on a header button or a column edge inside it (tabindex -1). A tablist is the same.
 */
const landsOn = (el: Element): boolean => {
  // A tablist is one stop too: the tab that is selected (the other one is reached with the arrow keys).
  if (el.getAttribute('role') === 'tab') return el.getAttribute('tabindex') !== '-1';
  return el.closest('[role="grid"], [role="treegrid"]') === null || el.getAttribute('tabindex') === '0';
};

/** The pane's element when F6 can visit it: there, not folded (inert or zero-wide); the toasts only with a toast. */
function usablePane(name: (typeof PANES)[number]): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-pane="${name}"]`);
  const usable = el !== null && el.closest('[inert]') === null && el.getBoundingClientRect().width > 0 && (name !== 'toasts' || el.querySelector('.toast') !== null);
  return usable ? el : null;
}

/**
 * A control a pane names as the place to land (`data-pane-landing`) goes first while it can take the focus: the tutor's text area,
 * when the tutor shows a session (spec 8.11). It is passed over while it is off (the item still opening).
 */
const LANDING = '[data-pane-landing]:not(:disabled)';

/** Where F6 lands in a pane: the control it names, else its first control that takes the focus now, else the pane itself. */
function landIn(pane: HTMLElement): void {
  const named = pane.querySelector<HTMLElement>(LANDING);
  for (const target of [...(named ? [named] : []), ...[...pane.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(landsOn)]) {
    target.focus();
    // Landed once the focus is in the target (a grid hands its focus on to the stop row).
    if (target.contains(document.activeElement)) return;
  }
  pane.tabIndex = -1; // nothing to land on: the pane itself
  pane.focus();
}

/** F6 / ⇧F6: next / previous pane (sidebar → content → item panel → toasts); folded (inert) and absent panes are skipped. */
export function focusPane(direction: 1 | -1): void {
  const panes = PANES.flatMap((name) => usablePane(name) ?? []);
  if (panes.length === 0) return;
  const at = panes.findIndex((p) => p.contains(document.activeElement));
  landIn(panes[at === -1 ? (direction === 1 ? 0 : panes.length - 1) : (at + direction + panes.length) % panes.length]!);
}

/** The focus where F6 would land in pane `name` (quick search's esc hands it to the table); false when it is not there. */
export function focusPaneNamed(name: (typeof PANES)[number]): boolean {
  const pane = usablePane(name);
  if (pane) landIn(pane);
  return pane !== null;
}
