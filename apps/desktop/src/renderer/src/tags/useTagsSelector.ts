import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { saveSetting } from '../data/saveSetting';
import { parseTagsSelector, type TagsSelector } from '../organize/viewSettings';

/**
 * The selector's 표시 and 정렬 (library setting `tags.selector`, spec 4.3): parsed, the defaults when unset, written
 * optimistically. `ready` once the read has answered (success or not), so the chips are not drawn in the default order for a frame.
 */
export function useTagsSelector(): { selector: TagsSelector; update(patch: Partial<TagsSelector>): void; ready: boolean } {
  const read = useQuery({ queryKey: keys.tagsSelector, queryFn: () => unwrap(api().settings.get({ key: 'tags.selector' })) });
  const selector = useMemo(() => parseTagsSelector(read.data ?? null), [read.data]);
  const update = useCallback((patch: Partial<TagsSelector>) => {
    // From the newest value in the cache, not the render's: two quick choices both land.
    const current = parseTagsSelector(queryClient.getQueryData(keys.tagsSelector) ?? null);
    saveSetting('tags.selector', { ...current, ...patch });
  }, []);
  return { selector, update, ready: !read.isPending };
}
