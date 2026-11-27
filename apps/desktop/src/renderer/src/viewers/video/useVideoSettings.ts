import { useQuery } from '@tanstack/react-query';
import { isPlaybackRate, type PlaybackRate } from '@learn/domain';
import { api, unwrap } from '../../api';
import { saveSetting, settingKey } from '../../data/saveSetting';

const read = (key: 'video.playbackRate' | 'video.volume' | 'video.muted') => ({
  queryKey: settingKey(key),
  queryFn: () => unwrap(api().settings.get({ key })),
});

export interface VideoSettings {
  rate: PlaybackRate;
  /** 0–1. */
  volume: number;
  muted: boolean;
  /** The three are read: the player applies them once, before its first play. */
  loaded: boolean;
  setRate(rate: PlaybackRate): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * The playback speed, volume and mute the library remembers (settings 'video.*'): one query per key, so every video tab follows the
 * same values. Unset reads as 1×, full volume, not muted; a value that does not fit reads as unset.
 */
export function useVideoSettings(): VideoSettings {
  const rate = useQuery(read('video.playbackRate'));
  const volume = useQuery(read('video.volume'));
  const muted = useQuery(read('video.muted'));
  return {
    rate: typeof rate.data === 'number' && isPlaybackRate(rate.data) ? rate.data : 1,
    volume: typeof volume.data === 'number' ? clamp01(volume.data) : 1,
    muted: muted.data === true,
    loaded: !rate.isPending && !volume.isPending && !muted.isPending,
    setRate: (v) => saveSetting('video.playbackRate', v),
    setVolume: (v) => saveSetting('video.volume', clamp01(v)),
    setMuted: (v) => saveSetting('video.muted', v),
  };
}
