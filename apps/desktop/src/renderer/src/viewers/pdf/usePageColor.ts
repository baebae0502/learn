import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PageColor } from '@learn/domain';
import { api, unwrap } from '../../api';
import { settingKey } from '../../data/saveSetting';
import { parsePageColor, resolvePageColor } from './pageColor';

type Shade = 'light' | 'dark';

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const themeShade = (): Shade => (document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light');

/**
 * The reader's page colour: the saved choice (`setting`, 앱 테마 따르기 until one is made) and the colour the pages are
 * drawn in (`resolved`), which follows the theme shown while the choice is 앱 테마 따르기.
 */
export function usePageColor(): { setting: PageColor; resolved: 'original' | 'sepia' | 'dark' } {
  const read = useQuery({ queryKey: settingKey('reader.pageColor'), queryFn: () => unwrap(api().settings.get({ key: 'reader.pageColor' })) });
  const shade = useSyncExternalStore(subscribeTheme, themeShade, () => 'light' as const);
  const setting = parsePageColor(read.data);
  return { setting, resolved: resolvePageColor(setting, shade) };
}
