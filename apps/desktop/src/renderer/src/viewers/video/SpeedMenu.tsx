import { PLAYBACK_RATES, isPlaybackRate } from '@learn/domain';
import { t } from '../../strings';
import { capsOf } from './capsOf';
import { MenuButton, type MenuButtonItem } from '../../ui/MenuButton';
import { useVideoSettings } from './useVideoSettings';

/** The speed button (spec 6.2): it names the speed in force and its menu lists the seven, the current one checked. */
export function SpeedMenu({ isDisabled }: { isDisabled: boolean }) {
  const settings = useVideoSettings();
  const items: MenuButtonItem<string>[] = PLAYBACK_RATES.map((r) => ({ id: String(r), label: t.video.rate(r), checked: r === settings.rate, testId: `video-speed-${r}` }));
  return (
    <MenuButton
      label={t.video.rate(settings.rate)}
      items={items}
      isDisabled={isDisabled}
      placement="bottom end"
      variant="plain"
      size="small"
      chevron={false}
      ariaLabel={t.video.speedName(settings.rate)}
      menuLabel={t.video.speed}
      tooltip={{ label: t.video.speed, keys: capsOf('video.slower', 'video.faster') }}
      triggerClassName="speed-btn"
      popoverClassName="speed-menu"
      testId="video-speed"
      onAction={(id) => {
        const rate = Number(id);
        if (isPlaybackRate(rate)) settings.setRate(rate);
      }}
    />
  );
}
