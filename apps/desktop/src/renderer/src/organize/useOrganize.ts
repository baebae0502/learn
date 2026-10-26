import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrganizeSnapshot } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys, useItems } from '../data/queries';
import { organizeModelFor, type OrganizeModel } from './model';

/**
 * The organize snapshot (spec 10.1) and the model built from it and the current item list. The model waits for both:
 * counts read before the list arrived would be zero. `settled` once the snapshot's read has answered, success or not.
 */
export function useOrganize(): { snapshot: OrganizeSnapshot | undefined; model: OrganizeModel | undefined; settled: boolean } {
  const read = useQuery({ queryKey: keys.organize, queryFn: () => unwrap(api().library.organize()) });
  const items = useItems().data;
  const snapshot = read.data;
  const model = useMemo(() => (snapshot !== undefined && items !== undefined ? organizeModelFor(snapshot, items) : undefined), [snapshot, items]);
  return { snapshot, model, settled: read.isSuccess || read.isError };
}
