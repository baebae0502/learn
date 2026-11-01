import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { useLearnEvent } from '../events';
import { focusRegained } from './editedCopies';

/**
 * An item's edited copies (M6 spec 6). Another app writes them and main announces nothing for that, so the panel reads
 * them whenever it shows the item (fresh, not from the cache), when this window gets the focus back (the user returns
 * from the app that edited it), after an import run ends (새 자료로 가져오기 removes the copy after its commit), and with
 * every notice that reads the item's detail again (the key is under it).
 */
export function useEditedCopies(itemId: string) {
  const query = useQuery({
    queryKey: keys.editedCopies(itemId),
    queryFn: () => unwrap(api().library.editedCopies({ itemId })),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const focused = useRef<boolean | null>(null);
  useLearnEvent('windowState', ({ focused: now }) => {
    if (focusRegained(focused.current, now)) void query.refetch();
    focused.current = now;
  });
  useLearnEvent('import:finished', () => void query.refetch());
  return query;
}
