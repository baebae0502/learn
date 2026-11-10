import type { ReadingPosition } from '@learn/domain';
import { formatDate, formatDuration } from '../format';
import { progressShown } from '../library/columns';
import { t } from '../strings';

/** The 읽기 section's line: where reading stopped and when it was last opened (the day the table's date columns show). */
export function readingLine(position: ReadingPosition, now: Date): string {
  const { locator } = position;
  const date = formatDate(position.openedAt ?? position.updatedAt, now).replace(/ /g, '\u00a0');
  // An image has no page or time to stop at.
  if (locator.kind === 'image') return t.inspector.reading.viewed(date);
  const where = locator.kind === 'pdf' ? t.inspector.reading.stoppedAtPage(locator.pageIndex + 1, locator.pages) : t.inspector.reading.stoppedAtTime(formatDuration(locator.timeMs));
  return t.inspector.reading.line(where, date);
}

/** The progress part of the section: the bar with its percent, the finished flag alone (as the table's progress cell shows it), or nothing while the total is unknown. */
export type ReadingProgressView = { kind: 'none' } | { kind: 'bar'; percent: number } | { kind: 'done' };

export function readingProgressView(progress: number | null): ReadingProgressView {
  if (progress === null) return { kind: 'none' };
  const shown = progressShown(progress);
  return shown === 'done' ? { kind: 'done' } : { kind: 'bar', percent: shown };
}
