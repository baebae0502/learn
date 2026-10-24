// M4 adds the item panel after content (design-spec 8.3). The toast region (ui/toasts.tsx, data-pane="toasts") exists
// only while a toast is visible; it is the last stop so F6 still reaches a toast once the keymap owns F6 (R-1).
const PANES = ['sidebar', 'content', 'toasts'] as const;
/**
 * Where F6 lands in a pane: its first control that does something and can take the focus now. A control disabled with
 * a reason (ui/disabledReason.tsx) stays a Tab stop for its tooltip, but F6 goes past it (이전 쪽 on page 1); the
 * player is a control (the video reader); a hidden one (the player behind the codec notice) is passed over.
 */
const FOCUSABLE =
  'button:not([disabled]):not([aria-disabled="true"]), [href], input:not([disabled]), select:not([disabled]), video[controls], [tabindex="0"]:not([aria-disabled="true"]), [role="option"]';

/**
 * A grid (the library table) is one stop with a roving focus: F6 lands on its stop row (tabindex 0: the cursor, or the
 * first row before there is one), never on a header button or a column edge inside it (tabindex -1).
 */
const landsOn = (el: Element): boolean => el.closest('[role="grid"]') === null || el.getAttribute('tabindex') === '0';

/** F6 / ⇧F6: next / previous pane (sidebar → content → toasts); folded (inert) and absent panes are skipped. */
export function focusPane(direction: 1 | -1): void {
  const panes = PANES.flatMap((name) => {
    const el = document.querySelector<HTMLElement>(`[data-pane="${name}"]`);
    const usable = el !== null && el.closest('[inert]') === null && el.getBoundingClientRect().width > 0 && (name !== 'toasts' || el.querySelector('.toast') !== null);
    return usable ? [el] : [];
  });
  if (panes.length === 0) return;
  const at = panes.findIndex((p) => p.contains(document.activeElement));
  const next = panes[at === -1 ? (direction === 1 ? 0 : panes.length - 1) : (at + direction + panes.length) % panes.length]!;
  for (const target of [...next.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(landsOn)) {
    target.focus();
    // Landed once the focus is in the target (a grid hands its focus on to the stop row).
    if (target.contains(document.activeElement)) return;
  }
  next.tabIndex = -1; // nothing to land on: the pane itself
  next.focus();
}
