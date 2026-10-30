import type { OrganizeSnapshot } from '@learn/domain';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';

/** The organize snapshot the cache holds now (undefined before the first read, or after a failed one). */
export const cachedSnapshot = (): OrganizeSnapshot | undefined => queryClient.getQueryData<OrganizeSnapshot>(keys.organize);

/** Changes the snapshot in the cache; the notice main sends next brings the real one. */
export function patchSnapshot(update: (s: OrganizeSnapshot) => OrganizeSnapshot): void {
  queryClient.setQueryData<OrganizeSnapshot>(keys.organize, (s) => (s ? update(s) : s));
}
