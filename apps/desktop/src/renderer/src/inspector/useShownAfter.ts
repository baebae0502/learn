import { useEffect, useState } from 'react';

/** True once `active` has lasted `ms` (design-spec 6: a load under 300 ms shows nothing); false as soon as it ends. */
export function useShownAfter(active: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && late;
}
