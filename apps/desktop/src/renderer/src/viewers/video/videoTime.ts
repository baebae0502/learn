const whole = (ms: number): number => (Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0);

/**
 * The clock beside the scrubber: m:ss, and h:mm:ss for the whole video once it lasts an hour or more, so the digits do not
 * change shape while it plays. Rounded down, as a player's clock is: 18.9 s still reads 0:18.
 */
export function formatClock(ms: number, durationMs: number): string {
  const total = whole(ms);
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return whole(durationMs) >= 3600 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${Math.floor(total / 60)}:${s}`;
}

/** The time as a screen reader says it (the scrubber's aria-valuetext): "1시간 2분 3초", without the zero parts that end it. */
export function spokenClock(ms: number): string {
  const total = whole(ms);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}시간`);
  if (m > 0 || (h > 0 && s > 0)) parts.push(`${m}분`);
  if (s > 0 || parts.length === 0) parts.push(`${s}초`);
  return parts.join(' ');
}
