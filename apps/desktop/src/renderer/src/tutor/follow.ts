/** How near the bottom the conversation counts as at the bottom. */
export const FOLLOW_SLACK = 24;

/** The column's bottom is within 24 px of view. */
export function nearBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
}

/**
 * Whether the column keeps to the bottom as the answer grows: the user scrolling up stops it, coming back to the bottom or pressing
 * 최신으로 starts it again, and more text coming never changes it (the place the user went to read stays theirs).
 */
export function nextFollow(following: boolean, e: 'scrolled-up' | 'reached-bottom' | 'pressed-latest' | 'append'): boolean {
  switch (e) {
    case 'scrolled-up':
      return false;
    case 'reached-bottom':
    case 'pressed-latest':
      return true;
    case 'append':
      return following;
  }
}
