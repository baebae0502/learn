import { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { Slider, SliderThumb, SliderTrack } from 'react-aria-components';
import { commandById, commandLabel, keySpecKeys } from '@learn/domain';
import { t } from '../../strings';
import { IconButton } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { currentPlatform } from '../../ui/platform';
import { useReaderScope, useReaderShown } from '../readerScope';
import { useVideoSettings } from './useVideoSettings';

/** A reader narrower than this folds the bar (spec 6.2). */
const FOLD_BELOW = 560; // local: the spec's width
/** The open bar's width and its gap to the button (video.css .vtrack-slider, .volume). */
const BAR_WIDTH = 64 + 4; // local: the mockup's bar and the row's gap

/**
 * The mute button and the volume bar (spec 6.2). The bar folds when the reader is narrower than 560 or when the row of controls would
 * overflow (a large text size): the button stays, and the bar floats over it while the pointer or the focus is there.
 * The bar's value is saved when the change ends, the mute at once.
 */
export function VolumeControl({ isDisabled, rowRef }: { isDisabled: boolean; rowRef: React.RefObject<HTMLDivElement | null> }) {
  const settings = useVideoSettings();
  const shown = useReaderShown();
  const store = useReaderScope().video;
  const [folded, setFolded] = useState(false);
  const [near, setNear] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const foldedRef = useRef(false);

  // A hidden tab does not watch sizes (it has none to measure, and a size of 0 would fold the bar for good).
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !shown) return;
    const judge = () => {
      const reader = row.closest('.reader');
      const readerWidth = reader?.clientWidth ?? 0;
      if (readerWidth === 0 || row.clientWidth === 0) return;
      // What the row needs with the bar open, from the widths of its parts: the same answer whether the bar is drawn now or not.
      const parts = [...row.children].filter((c) => !c.classList.contains('spacer') && c !== group.current) as HTMLElement[];
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const buttons = group.current?.querySelector<HTMLElement>('.icon-btn')?.offsetWidth ?? 0;
      const needed = parts.reduce((w, c) => w + c.offsetWidth, 0) + buttons + BAR_WIDTH + gap * (parts.length + 1);
      const next = readerWidth < FOLD_BELOW || needed > row.clientWidth;
      if (next !== foldedRef.current) {
        foldedRef.current = next;
        setFolded(next);
      }
    };
    judge();
    const ro = new ResizeObserver(judge);
    ro.observe(row);
    return () => ro.disconnect();
  }, [rowRef, shown, settings.rate]);

  const value = settings.muted ? 0 : (draft ?? settings.volume);
  const Glyph = settings.muted || value === 0 ? VolumeX : value <= 0.5 ? Volume1 : Volume2;
  const platform = currentPlatform();
  const spec = commandById('video.toggleMute');
  const label = commandLabel(spec, platform, { videoMuted: settings.muted });
  const open = folded && near;

  const slider = (
    <Slider
      className="vtrack-slider"
      aria-label={t.video.volume}
      minValue={0}
      maxValue={1}
      step={0.05}
      value={value}
      isDisabled={isDisabled}
      onChange={(v) => {
        setDraft(v);
        store.getState().patch({ volumeDraft: v }); // the sound follows the bar while it moves
        // Moving the bar is the wish to hear: it unmutes, as a player's does.
        if (settings.muted && v > 0) settings.setMuted(false);
      }}
      onChangeEnd={(v) => {
        setDraft(null);
        settings.setVolume(v);
        store.getState().patch({ volumeDraft: null });
      }}
      data-testid="video-volume"
    >
      <SliderTrack className="vtrack">
        {({ state }) => (
          <>
            <i style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
            <SliderThumb className="vthumb" />
          </>
        )}
      </SliderTrack>
    </Slider>
  );

  return (
    <div
      ref={group}
      className={cx('volume', folded && 'is-folded')}
      onPointerEnter={() => setNear(true)}
      onPointerLeave={() => setNear(false)}
      onFocus={() => setNear(true)}
      onBlur={(e) => {
        if (!group.current?.contains(e.relatedTarget as Node | null)) setNear(false);
      }}
    >
      <IconButton
        icon={Glyph}
        label={label}
        keys={keySpecKeys(spec.key!, platform).join(platform === 'darwin' ? '' : '+')}
        tooltipPlacement="top"
        isDisabled={isDisabled}
        onPress={() => settings.setMuted(!settings.muted)}
        testId="video-mute"
      />
      {!folded && <span className="vbar">{slider}</span>}
      {open && <span className="vol-pop">{slider}</span>}
    </div>
  );
}
