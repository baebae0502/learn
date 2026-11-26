import { useRef } from 'react';
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { commandById, commandLabel, keySpecKeys, type CommandId } from '@learn/domain';
import { t } from '../../strings';
import { IconButton } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { currentPlatform } from '../../ui/platform';
import { Scrubber } from './Scrubber';
import { SpeedMenu } from './SpeedMenu';
import { VolumeControl } from './VolumeControl';
import { formatClock } from './videoTime';
import { useVideo } from './videoStore';

/** A command's keys as a tooltip says them: "K · 스페이스", "J" (a Mac spells ⇧ before the key, elsewhere Shift+). */
function capsOf(...ids: CommandId[]): string {
  const platform = currentPlatform();
  const spec = (id: CommandId) => commandById(id);
  return ids
    .flatMap((id) => [spec(id).key, spec(id).alsoKey])
    .flatMap((k) => (k ? [keySpecKeys(k, platform).join(platform === 'darwin' ? '' : '+')] : []))
    .join(' · ');
}

/**
 * The bar under the picture (spec 6.2): the scrubber and a row of 32 — ten seconds back, play, ten seconds on, the clock, the
 * speed and the volume. Drawn disabled until the first frame is there. Slots for the subtitle and full-screen buttons are
 * not drawn: they come with the tasks that make them work.
 */
export function VideoControls() {
  const status = useVideo((s) => s.status);
  const playing = useVideo((s) => s.playing);
  const timeMs = useVideo((s) => s.timeMs);
  const durationMs = useVideo((s) => s.durationMs);
  const handle = useVideo((s) => s.handle);
  const rowRef = useRef<HTMLDivElement>(null);
  const disabled = status !== 'ready';
  const platform = currentPlatform();
  const playLabel = commandLabel(commandById('video.playPause'), platform, { videoPlaying: playing });
  return (
    <div className={cx('video-controls', disabled && 'is-disabled')} role="group" aria-label={t.video.controls} data-testid="video-controls">
      <Scrubber />
      <div className="control-row" ref={rowRef}>
        <IconButton icon={RotateCcw} label={t.video.back10} keys={capsOf('video.back10')} tooltipPlacement="top" isDisabled={disabled} onPress={() => handle?.seekBy(-10_000)} testId="video-back10" />
        <IconButton icon={playing ? Pause : Play} label={playLabel} keys={capsOf('video.playPause')} tooltipPlacement="top" isDisabled={disabled} onPress={() => handle?.togglePlay()} testId="video-play" />
        <IconButton icon={RotateCw} label={t.video.forward10} keys={capsOf('video.forward10')} tooltipPlacement="top" isDisabled={disabled} onPress={() => handle?.seekBy(10_000)} testId="video-forward10" />
        <span className="time num" data-testid="video-time">
          <b>{formatClock(timeMs, durationMs)}</b> / {formatClock(durationMs, durationMs)}
        </span>
        <span className="spacer" />
        <SpeedMenu isDisabled={disabled} />
        <VolumeControl isDisabled={disabled} rowRef={rowRef} />
      </div>
    </div>
  );
}
