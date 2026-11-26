import { subtitleFormatOf, type AttachFailure } from '@learn/domain';

/**
 * What a dragover tells of a file is its MIME only (the name is hidden until the drop). `.srt` is reported as an empty type,
 * `text/plain` or `application/x-subrip` by platform, `.vtt` as `text/vtt` (spec 5.3, 18).
 */
export const SUBTITLE_DRAG_TYPES = ['text/vtt', 'application/x-subrip', 'text/plain', ''] as const;

/** Whether a drag over a video tab may carry subtitles: files only, every one of a subtitle-like type, at least one. */
export function acceptsSubtitleDrag(items: ReadonlyArray<{ kind: string; type: string }>): boolean {
  return items.length > 0 && items.every((i) => i.kind === 'file' && (SUBTITLE_DRAG_TYPES as readonly string[]).includes(i.type));
}

const nameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** The drop filters by extension again (the drag could only guess by MIME): the rest are reported as rows, not attached. */
export function splitDroppedPaths(paths: readonly string[]): { subtitles: string[]; rejected: AttachFailure[] } {
  const subtitles: string[] = [];
  const rejected: AttachFailure[] = [];
  for (const p of paths) {
    if (subtitleFormatOf(p) !== null) subtitles.push(p);
    else rejected.push({ name: nameOf(p), reason: 'not-subtitle' });
  }
  return { subtitles, rejected };
}
