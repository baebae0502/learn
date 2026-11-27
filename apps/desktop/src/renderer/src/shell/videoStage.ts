import { create } from 'zustand';

/**
 * Whether the window is on the video stage (spec 6.6). Only main decides: useWindowState writes it from main's window state, and
 * every screen reads it from here; nothing in the page turns the stage on or off itself.
 */
export const useVideoStage = create<{ on: boolean }>(() => ({ on: false }));

export const setVideoStage = (on: boolean): void => {
  if (useVideoStage.getState().on !== on) useVideoStage.setState({ on });
};
