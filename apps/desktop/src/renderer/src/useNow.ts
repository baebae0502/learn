import { useEffect, useState } from 'react';
import { msUntilMidnight } from './format';

/**
 * The current time, renewed at every local midnight: relative dates ("오늘 오전 9:24", "어제 …") move on while the
 * window stays open. A timer that fires late (sleep) still lands after midnight; one second of slack covers clock skew.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setTimeout(() => setNow(new Date()), msUntilMidnight(now) + 1000);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}
