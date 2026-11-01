/**
 * Whether a windowState push is this window getting the focus back (it was away at the push before): the moment the user
 * returns from the app that edited a copy. The first state a panel hears is not one (it knew no state before).
 */
export const focusRegained = (before: boolean | null, now: boolean): boolean => now && before === false;
