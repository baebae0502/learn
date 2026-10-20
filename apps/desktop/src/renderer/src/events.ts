import { useEffect, useRef } from 'react';
import type { LearnEventMap } from '@learn/domain';
import { api } from './api';

/** Subscribes to a main -> renderer push event for the component's lifetime; always calls the latest `cb`. */
export function useLearnEvent<K extends keyof LearnEventMap>(name: K, cb: (payload: LearnEventMap[K]) => void): void {
  const latest = useRef(cb);
  useEffect(() => {
    latest.current = cb;
  });
  useEffect(() => api().on(name, (payload) => latest.current(payload)), [name]);
}
