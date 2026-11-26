import { useMemo } from 'react';
import { Captions, CaptionsOff } from 'lucide-react';
import { commandById } from '@learn/domain';
import { useCommands } from '../../commands/CommandProvider';
import { t } from '../../strings';
import { MENU_SEPARATOR, MenuButton, type MenuButtonItem, type MenuEntry } from '../../ui/MenuButton';
import { capsOf } from './capsOf';
import { trackNames } from './trackNames';
import { useVideo } from './videoStore';

type Id = 'off' | 'add' | 'remove' | `track:${string}`;

/**
 * 자막 ▾ (spec 6.5): the button names what shows (the track, 자막 끔, or 자막 없음), the menu lists the tracks (the one on checked), 끄기 (C),
 * the file picker and, last as a risky action, 이 자막 제거 (only while a track is on). With no track the menu is the picker alone.
 */
export function SubtitlesMenu({ isDisabled }: { isDisabled: boolean }) {
  const tracks = useVideo((s) => s.tracks);
  const trackId = useVideo((s) => s.trackId);
  const captionsOn = useVideo((s) => s.captionsOn);
  const handle = useVideo((s) => s.handle);
  const { run } = useCommands();
  const names = useMemo(() => trackNames(tracks), [tracks]);
  const shown = trackId !== null && captionsOn;
  const name = trackId === null ? undefined : (names.get(trackId) ?? t.video.captions);
  const add: MenuButtonItem<Id> = { id: 'add', label: commandById('video.addSubtitles').label, testId: 'subtitle-add' };
  const items: MenuEntry<Id>[] =
    tracks.length === 0
      ? [add]
      : [
          {
            items: [
              ...tracks.map((track): MenuButtonItem<Id> => ({ id: `track:${track.assetId}`, label: names.get(track.assetId) ?? '', checked: shown && track.assetId === trackId, testId: `subtitle-track-${track.assetId}` })),
              { id: 'off', label: t.video.captionsOffItem, accelerator: 'C', checked: !shown, testId: 'subtitle-off' },
            ],
          },
          MENU_SEPARATOR,
          add,
          MENU_SEPARATOR,
          { id: 'remove', label: t.video.removeSubtitle, isDisabled: !shown, testId: 'subtitle-remove' },
        ];
  return (
    <MenuButton
      label={name === undefined ? t.video.noCaptions : shown ? name : t.video.captionsOff}
      icon={shown ? Captions : CaptionsOff}
      items={items}
      isDisabled={isDisabled}
      placement="bottom end"
      variant="plain"
      size="small"
      menuLabel={t.video.captions}
      {...(shown && name !== undefined ? { ariaLabel: t.video.captionsNamed(name) } : {})}
      tooltip={{ label: t.video.captions, keys: capsOf('video.toggleCaptions') }}
      popoverClassName="subtitles-menu"
      testId="subtitles-menu"
      onAction={(id) => {
        if (id === 'add') run('video.addSubtitles');
        else if (id === 'off') handle?.captionsOff();
        else if (id === 'remove') {
          if (name !== undefined) handle?.removeTrack(name);
        } else handle?.selectTrack(id.slice('track:'.length));
      }}
    />
  );
}
