import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { READER_NAVS, type ReaderNav } from '@learn/domain';
import { api, unwrap } from '../../api';
import { settingKey } from '../../data/saveSetting';

/** Read before the window's first paint (Boot), so a restored reader's sidebar lists the saved choice in its first frame (R38). */
export const useReaderNavSetting = (): UseQueryResult<unknown> =>
  useQuery({ queryKey: settingKey('reader.nav'), queryFn: () => unwrap(api().settings.get({ key: 'reader.nav' })) });

/**
 * What the reader's sidebar lists: the saved choice, or the thumbnails until one is made (or when the stored value is unreadable).
 * `null` while the choice has not been read: the sidebar then draws no selection and no list, rather than the default first (R38).
 */
export function useReaderNav(): ReaderNav | null {
  const read = useReaderNavSetting();
  if (read.isPending) return null;
  return READER_NAVS.find((n) => n === read.data) ?? 'thumbnails';
}
