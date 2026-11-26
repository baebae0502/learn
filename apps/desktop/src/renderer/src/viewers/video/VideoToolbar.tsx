import { t } from '../../strings';
import { cx } from '../../ui/cx';

/**
 * The video reader's 44 px strip (spec 6.1). Its right side is where the subtitle menu stands once there are subtitles to choose
 * from; nothing is drawn for what does not exist yet. Disabled while the first frame is awaited (design-spec 6: a passing state
 * keeps its controls).
 */
export function VideoToolbar({ disabled }: { disabled: boolean }) {
  return <div className={cx('reader-toolbar', 'video-toolbar', disabled && 'is-disabled')} role="toolbar" aria-label={t.video.toolbar} data-testid="video-toolbar" />;
}
