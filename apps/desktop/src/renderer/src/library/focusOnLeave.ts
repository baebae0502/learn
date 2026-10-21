import { useLayoutEffect, type RefObject } from 'react';

/**
 * Records in `hadFocus`, as the screen in `screen` goes away, whether focus was inside it. React runs a removed
 * component's layout cleanups before it detaches the DOM, so the focused element is still in the screen to be seen.
 * The list reads the flag and takes the focus over (MainWindow), instead of letting it fall to <body>.
 */
export function useFocusOnLeave(screen: RefObject<HTMLElement | null>, hadFocus: RefObject<boolean> | undefined): void {
  useLayoutEffect(() => {
    const el = screen.current;
    return () => {
      if (hadFocus) hadFocus.current = el !== null && el.contains(document.activeElement);
    };
  }, [screen, hadFocus]);
}
