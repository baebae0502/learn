import { VIDEO_TIMING } from '@learn/domain';
import type { CommandEnv } from '../../commands/registry';
import { useVideo } from './videoStore';

/** What the video commands do to the shown video (the CommandEnv's video part): through its handle, so nothing runs without a player. */
export const videoActions: Pick<CommandEnv, 'video'> = {
  video: (action) => {
    const h = useVideo.getState().handle;
    if (!h) return;
    switch (action) {
      case 'playPause': return h.togglePlay();
      case 'back10': return h.seekBy(-VIDEO_TIMING.skipLongMs);
      case 'forward10': return h.seekBy(VIDEO_TIMING.skipLongMs);
      case 'back5': return h.seekBy(-VIDEO_TIMING.skipShortMs);
      case 'forward5': return h.seekBy(VIDEO_TIMING.skipShortMs);
      case 'frameBack': return h.frame(-1);
      case 'frameForward': return h.frame(1);
      case 'slower': return h.nudgeRate(-1);
      case 'faster': return h.nudgeRate(1);
      case 'toggleMute': return h.toggleMute();
    }
  },
};
