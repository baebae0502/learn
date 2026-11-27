import { fileStem, languageTail, subtitleFormatOf } from './subtitles';

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'] as const;

export interface SubtitlePairing {
  /** Every path that is not a subtitle, in the batch's order. */
  rest: string[];
  /** video path → its subtitle paths, in the batch's order. */
  subtitlesOf: Map<string, string[]>;
  /** Subtitle paths with no video of the same stem in the batch. */
  unpaired: string[];
}

const lastSeparator = (p: string): number => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
const folderOf = (p: string): string => p.slice(0, lastSeparator(p));
const isVideo = (p: string): boolean => {
  const name = p.slice(lastSeparator(p) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && (VIDEO_EXTENSIONS as readonly string[]).includes(name.slice(dot + 1).toLowerCase());
};
const keyOf = (stem: string): string => stem.normalize('NFC').toLowerCase();

/**
 * Pairs subtitle files with the videos of the same batch by name, before any file is read: a subtitle's stem is its
 * video's, or its video's plus a language tail. Several videos of one stem: the one in the subtitle's folder, then the first.
 */
export function pairSubtitles(paths: readonly string[]): SubtitlePairing {
  const rest: string[] = [];
  const subtitles: string[] = [];
  const videosByKey = new Map<string, string[]>();
  const order = new Map<string, number>();
  for (const [i, p] of paths.entries()) {
    if (subtitleFormatOf(p) !== null) {
      subtitles.push(p);
      continue;
    }
    rest.push(p);
    if (!isVideo(p)) continue;
    if (!order.has(p)) order.set(p, i);
    const key = keyOf(fileStem(p));
    const same = videosByKey.get(key);
    if (same) same.push(p);
    else videosByKey.set(key, [p]);
  }
  const subtitlesOf = new Map<string, string[]>();
  const unpaired: string[] = [];
  for (const sub of subtitles) {
    const stem = fileStem(sub);
    const tail = languageTail(stem);
    const keys = new Set([keyOf(stem), ...(tail.language !== null ? [keyOf(tail.base)] : [])]);
    // The batch's order across both candidates, so "the first video" does not depend on which key matched.
    const candidates = [...new Set([...keys].flatMap((k) => videosByKey.get(k) ?? []))].sort((a, b) => order.get(a)! - order.get(b)!);
    const video = candidates.find((v) => folderOf(v) === folderOf(sub)) ?? candidates[0];
    if (video === undefined) {
      unpaired.push(sub);
      continue;
    }
    const mine = subtitlesOf.get(video);
    if (mine) mine.push(sub);
    else subtitlesOf.set(video, [sub]);
  }
  return { rest, subtitlesOf, unpaired };
}

/** Calls of at most `size` paths that never part a video from its subtitles (the renderer's 500-path chunker). */
export function groupForCalls(paths: readonly string[], size = 500): string[][] {
  const { subtitlesOf } = pairSubtitles(paths);
  const paired = new Set([...subtitlesOf.values()].flat());
  const units: string[][] = [];
  for (const p of paths) {
    if (paired.has(p)) continue;
    units.push([p, ...(subtitlesOf.get(p) ?? [])]);
  }
  const calls: string[][] = [];
  let call: string[] = [];
  for (const unit of units) {
    if (call.length + unit.length > size && call.length > 0) {
      calls.push(call);
      call = [];
    }
    if (unit.length > size) {
      // Only a group bigger than a call is split.
      for (let i = 0; i < unit.length; i += size) calls.push(unit.slice(i, i + size));
    } else call.push(...unit);
  }
  if (call.length > 0) calls.push(call);
  return calls;
}
