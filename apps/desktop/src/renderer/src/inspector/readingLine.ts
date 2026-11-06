import type { ReadingPosition } from '@learn/domain';
import { formatDate, formatDuration } from '../format';
import { t } from '../strings';

/** The 읽기 section's line: where reading stopped and when it was last opened (the day the table's date columns show). */
export function readingLine(position: ReadingPosition, now: Date): string {
  const { locator } = position;
  const where = locator.kind === 'pdf' ? t.inspector.reading.stoppedAtPage(locator.pageIndex + 1, locator.pages) : t.inspector.reading.stoppedAtTime(formatDuration(locator.timeMs));
  return t.inspector.reading.line(where, formatDate(position.openedAt ?? position.updatedAt, now).replace(/ /g, '\u00a0'));
}
