export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  left: number;
  top: number;
}

/**
 * Where the engine draws a picture of `video` size in a box of `box` size under object-fit: contain, in the box's coordinates. The subtitle
 * stands inside it (spec 6.4), not in the black bars around it. Null while either has no size: a tab that is not shown reads a box of 0.
 */
export function pictureRect(box: Size, video: Size): Rect | null {
  if (!(box.width > 0 && box.height > 0 && video.width > 0 && video.height > 0)) return null;
  const scale = Math.min(box.width / video.width, box.height / video.height);
  const width = video.width * scale;
  const height = video.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}
