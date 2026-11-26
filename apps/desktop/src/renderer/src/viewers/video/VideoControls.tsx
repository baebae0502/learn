import { useRef } from 'react';
import { Captions, CaptionsOff, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { commandById, commandLabel } from '@learn/domain';
import { useCommands } from '../../commands/CommandProvider';
import { useVideoStage } from '../../shell/videoStage';
import { t } from '../../strings';
import { IconButton } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { currentPlatform } from '../../ui/platform';
import { capsOf } from './capsOf';
import { Scrubber } from './Scrubber';
import { SpeedMenu } from './SpeedMenu';
import { VolumeControl } from './VolumeControl';
import { formatClock } from './videoTime';
import { useVideo } from './videoStore';

/**
 * The bar under the picture (spec 6.2): the scrubber and a row of 32 — ten seconds back, play, ten seconds on, the clock, the
 * speed, the subtitle button (turns the shown track on or off; disabled with its reason while there is none), the volume and the full-screen
 * button. Drawn disabled until the first frame is there. On the stage (spec 6.6) the bar lies over the picture's bottom, dark in both themes.
 */
export function VideoControls() {
  const status = useVideo((s) => s.status);
  const playing = useVideo((s) => s.playing);
  const timeMs = useVideo((s) => s.timeMs);
  const durationMs = useVideo((s) => s.durationMs);
  const handle = useVideo((s) => s.handle);
  const stage = useVideoStage((s) => s.on);
  const hasTrack = useVideo((s) => s.trackId !== null);
  const captionsOn = useVideo((s) => s.trackId !== null && s.captionsOn);
  const { run } = useCommands();
  const rowRef = useRef<HTMLDivElement>(null);
  const disabled = status !== 'ready';
  const platform = currentPlatform();
  const playLabel = commandLabel(commandById('video.playPause'), platform, { videoPlaying: playing });
  const stageLabel = commandLabel(commandById('video.toggleFullScreen'), platform, { videoStage: stage });
  const captionsLabel = commandLabel(commandById('video.toggleCaptions'), platform, { videoCaptionsOn: captionsOn });
  return (
    <div className={cx('video-controls', disabled && 'is-disabled')} role="group" aria-label={t.video.controls} data-testid="video-controls">
      <Scrubber />
      <div className="control-row" ref={rowRef}>
        <IconButton icon={RotateCcw} label={t.video.back10} keys={capsOf('video.back10')} tooltipPlacement="top" isDisabled={disabled} onPress={() => handle?.seekBy(-10_000)} testId="video-back10" />
        <IconButton icon={playing ? Pause : Play} label={playLabel} keys={capsOf('video.playPause')} tooltipPlacement="top" glyph="lg" isDisabled={disabled} onPress={() => handle?.togglePlay()} testId="video-play" />
        <IconButton icon={RotateCw} label={t.video.forward10} keys={capsOf('video.forward10')} tooltipPlacement="top" isDisabled={disabled} onPress={() => handle?.seekBy(10_000)} testId="video-forward10" />
        <span className="time num" data-testid="video-time">
          <b>{formatClock(timeMs, durationMs)}</b> / {formatClock(durationMs, durationMs)}
        </span>
        <span className="spacer" />
        <SpeedMenu isDisabled={disabled} />
        <IconButton icon={captionsOn ? Captions : CaptionsOff} label={captionsLabel} keys={capsOf('video.toggleCaptions')} tooltipPlacement="top" isOn={captionsOn} isDisabled={disabled || !hasTrack} {...(hasTrack ? {} : { disabledReason: t.video.noCaptions })} onPress={() => run('video.toggleCaptions')} testId="video-captions" />
        <VolumeControl isDisabled={disabled} rowRef={rowRef} />
        <IconButton icon={stage ? Minimize : Maximize} label={stageLabel} keys={capsOf('video.toggleFullScreen')} tooltipPlacement="top" isDisabled={disabled} onPress={() => run('video.toggleFullScreen')} testId="video-fullscreen" />
      </div>
    </div>
  );
}
