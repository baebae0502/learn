import { t } from '../../strings';
import { cx } from '../../ui/cx';
import { SubtitlesMenu } from './SubtitlesMenu';

/**
 * The video reader's 44 px strip (spec 6.1): the subtitle menu at its right and nothing else (the title is in the tab). Disabled while the
 * first frame is awaited (design-spec 6: a passing state keeps its controls).
 */
export function VideoToolbar({ disabled }: { disabled: boolean }) {
  return (
    <div className={cx('reader-toolbar', 'video-toolbar', disabled && 'is-disabled')} role="toolbar" aria-label={t.video.toolbar} data-testid="video-toolbar">
      <span className="spacer" />
      <SubtitlesMenu isDisabled={disabled} />
    </div>
  );
}
