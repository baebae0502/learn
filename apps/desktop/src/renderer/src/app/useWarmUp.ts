import { useEffect } from 'react';
import { whenIdle } from '../ui/whenIdle';
import { warmUp } from './warmUp';

/** Once the list has settled (`ready`), at the window's first idle moment (or after 2 s): warmUp. */
export function useWarmUp(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    let cancel = () => {};
    const stopIdle = whenIdle(() => (cancel = warmUp(document)), 2000);
    return () => {
      stopIdle();
      cancel();
    };
  }, [ready]);
}
