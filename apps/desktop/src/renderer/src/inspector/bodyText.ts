import { MARK_END, MARK_START, type BodyTextState } from '@learn/domain';
import { t } from '../strings';

/**
 * Where a PDF's body index stands, as the file section's 본문 검색 line and the 본문 일치 section say it (spec 5.8): every
 * state that is not done. A done index is quiet (null), unless it stopped at a limit: then how far it went.
 */
export function bodyStateLine(s: BodyTextState): string | null {
  switch (s.state) {
    case 'pending':
      return t.inspector.bodyText.pending;
    case 'empty':
      return t.inspector.bodyText.empty;
    case 'failed':
      return t.inspector.bodyText.failed[s.reason];
    case 'done':
      return s.truncated ? t.inspector.bodyText.truncated(s.pages) : null;
  }
}

/**
 * The state line where the index will be read (spec 5.7): none for an item in the trash, whose job waits for its restore, nor
 * for one whose original is missing, which cannot be read (the head says the original is missing).
 */
export function bodyLineFor(text: BodyTextState | null, where: { trashed: boolean; missing: boolean }): string | null {
  if (text === null || where.trashed || where.missing) return null;
  return bodyStateLine(text);
}

/**
 * What 본문 일치 shows for a PDF once its matching pages are known (`total`, 0 for a body not read): while the body is not read,
 * its state line in place of the rows; a read body's rows, then the line of an index cut at a limit (that line alone when nothing
 * matched, so no match does not read as none in the whole file); nothing when a whole index has no match, or for a missing
 * original that has nothing to show.
 */
export function matchesView(text: BodyTextState, missing: boolean, total: number): { rows: boolean; line: string | null } | null {
  const line = bodyLineFor(text, { trashed: false, missing });
  const rows = text.state === 'done' && total > 0;
  return rows || line !== null ? { rows, line } : null;
}

export interface SnippetPart {
  text: string;
  mark: boolean;
}

/**
 * A search:pages snippet in parts, the marked ones between U+E000 and U+E001: the screen draws each part as text (a mark
 * as <mark>), so nothing in a PDF's text is ever read as HTML. Marks that do not pair up mark nothing: the text alone.
 */
export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let open = false;
  let text = '';
  const flush = (mark: boolean) => {
    if (text !== '') parts.push({ text, mark });
    text = '';
  };
  for (const c of snippet) {
    if (c === MARK_START || c === MARK_END) {
      if (open === (c === MARK_START)) return unmarked(snippet);
      flush(open);
      open = !open;
    } else text += c;
  }
  if (open) return unmarked(snippet);
  flush(false);
  // Two plain parts meet where an empty mark was dropped: one part.
  return parts.reduce<SnippetPart[]>((out, p) => {
    const last = out[out.length - 1];
    if (last && last.mark === p.mark) last.text += p.text;
    else out.push({ ...p });
    return out;
  }, []);
}

const unmarked = (snippet: string): SnippetPart[] => {
  const text = snippet.replaceAll(MARK_START, '').replaceAll(MARK_END, '');
  return text === '' ? [] : [{ text, mark: false }];
};
