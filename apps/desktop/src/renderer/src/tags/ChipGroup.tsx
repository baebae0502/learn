import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../ui/cx';
import { chipKeyAction } from './chipKeys';

interface Stops {
  /** The chip the user was last on (the group's one Tab stop), or null. */
  stop: string | null;
  /** The first chip, which is the stop until the user has been on another. */
  first: string | null;
  setStop(id: string): void;
}
const StopsContext = createContext<Stops | null>(null);

/** A chip's place in its group's one Tab stop (roving tabindex). Outside a group (the state board) every chip is a stop. */
export function useChipStop(id: string): { tabIndex: 0 | -1; onFocus(): void } {
  const group = useContext(StopsContext);
  if (!group) return { tabIndex: 0, onFocus: () => {} };
  return { tabIndex: (group.stop ?? group.first) === id ? 0 : -1, onFocus: () => group.setStop(id) };
}

const CHIPS = '[data-chip-id]';
const chipsOf = (root: HTMLElement | null): HTMLElement[] => (root ? [...root.querySelectorAll<HTMLElement>(CHIPS)] : []);

/**
 * A group of chips that is one Tab stop (spec 4.3, design-spec 6): ←→ Home End move between the chips, whatever lines they
 * wrap onto, and Tab leaves the group from the chip the user was last on. Every focusable child carrying `data-chip-id` is
 * a stop of the group. `toolbar` is the selector's (its chips toggle a filter), `list` the item panel's.
 */
export function ChipGroup(props: { label: string; children: ReactNode; role?: 'toolbar' | 'list'; className?: string; testId?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  // Who leads, and whether the remembered chip is still there (it may have been deleted or filtered away): read from the DOM
  // after each render of the group. The updates bail out when nothing changed, so this settles in one pass.
  useLayoutEffect(() => {
    const ids = chipsOf(root.current).map((el) => el.dataset['chipId']!);
    const lead = ids[0] ?? null;
    setFirst((prev) => (prev === lead ? prev : lead));
    setStop((prev) => (prev !== null && !ids.includes(prev) ? null : prev));
  });
  const value = useMemo<Stops>(() => ({ stop, first, setStop }), [stop, first]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const chip = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(CHIPS) : null;
    if (!chip || e.target !== chip || e.defaultPrevented) return;
    const action = chipKeyAction(e, 'filter');
    if (action?.kind !== 'move') return;
    const chips = chipsOf(root.current);
    const at = chips.indexOf(chip);
    const to = action.to === 'first' ? 0 : action.to === 'last' ? chips.length - 1 : at + (action.to === 'next' ? 1 : -1);
    const target = chips[Math.max(0, Math.min(chips.length - 1, to))];
    e.preventDefault();
    if (target && target !== chip) target.focus();
  };

  return (
    <StopsContext.Provider value={value}>
      <div ref={root} role={props.role ?? 'toolbar'} aria-label={props.label} className={cx('chip-group', props.className)} data-testid={props.testId} onKeyDown={onKeyDown}>
        {props.children}
      </div>
    </StopsContext.Provider>
  );
}
