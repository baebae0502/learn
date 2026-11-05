import { useQuery } from '@tanstack/react-query';
import { READER_NAVS, type ReaderNav } from '@learn/domain';
import { api, unwrap } from '../../api';
import { settingKey } from '../../data/saveSetting';

/** What the reader's sidebar lists: the saved choice, or the thumbnails until one is made (or when the stored value is unreadable). */
export function useReaderNav(): ReaderNav {
  const read = useQuery({ queryKey: settingKey('reader.nav'), queryFn: () => unwrap(api().settings.get({ key: 'reader.nav' })) });
  return READER_NAVS.find((n) => n === read.data) ?? 'thumbnails';
}
