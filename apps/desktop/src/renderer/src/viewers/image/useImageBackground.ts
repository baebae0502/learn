import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ImageBackground } from '@learn/domain';
import { api, unwrap } from '../../api';
import { settingKey } from '../../data/saveSetting';
import { useThemeShade } from '../pdf/usePageColor';
import { effectiveBackground, parseImageBackground } from './imageView';

/** Read before the window's first paint (Boot), so the first picture is on the saved ground, not the theme's first. */
export const useImageBackgroundSetting = (): UseQueryResult<unknown> =>
  useQuery({ queryKey: settingKey('reader.imageBackground'), queryFn: () => unwrap(api().settings.get({ key: 'reader.imageBackground' })) });

/** The ground behind the pictures: the library's choice (`stored`, nothing until one is made) and the one in use (`resolved`). */
export function useImageBackground(): { stored: ImageBackground | undefined; resolved: ImageBackground } {
  const read = useImageBackgroundSetting();
  const shade = useThemeShade();
  const stored = parseImageBackground(read.data);
  return { stored, resolved: effectiveBackground(stored, shade) };
}
