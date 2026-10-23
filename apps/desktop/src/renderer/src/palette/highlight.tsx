import type { ReactNode } from 'react';
import type { Match } from './hangul';

/** The matched code points of a label in <mark> (accent text, semibold — palette.css). */
export function highlight(label: string, match: Match | null): ReactNode {
  if (!match) return label;
  const chars = [...label.normalize('NFC')];
  return (
    <>
      {chars.slice(0, match.start).join('')}
      <mark>{chars.slice(match.start, match.end).join('')}</mark>
      {chars.slice(match.end).join('')}
    </>
  );
}
