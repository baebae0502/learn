/**
 * The answer's small Markdown (spec 8.3): paragraphs and their line breaks, bulleted and numbered lists two levels deep, bold,
 * italic, inline code, code blocks and quotes. A heading is a bold paragraph; tables, HTML, links and images stay the text they are,
 * so a model's output never makes something to follow or to load. `[[pN]]` outside code is a citation (spec 7). The result is data
 * that AnswerText draws as React elements only.
 */
export type Inline = { kind: 'text'; text: string } | { kind: 'strong' | 'em'; children: Inline[] } | { kind: 'code'; text: string } | { kind: 'cite'; pageIndex: number } | { kind: 'break' };
export type AnswerBlock =
  | { kind: 'p'; inline: Inline[] }
  // Two levels. `start`: a numbered list's first number when it is not 1 (a list a paragraph interrupted goes on at its number).
  // `blocks`: what an item holds after its first lines — a paragraph, a code block, a quote indented under it.
  | { kind: 'list'; ordered: boolean; start?: number; items: Array<{ inline: Inline[]; sub: AnswerBlock | null; blocks?: AnswerBlock[] }> }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; blocks: AnswerBlock[] };

const BLANK = /^\s*$/;
const FENCE = /^ {0,3}```/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
/** A list item: its indent, its marker (and the number of a numbered one), the spaces after it, and its text. */
const ITEM = /^( *)([-*+]|(\d{1,9})[.)])([ \t]+)(.*)$/;
const indentOf = (line: string): number => /^ */.exec(line)![0].length;
const CITE_AT = /^\[\[p([1-9][0-9]{0,5})\]\]/;
const WORD = /[\p{L}\p{N}]/u;

/** A list item line that may cut a paragraph short: a bullet, or a numbered item that starts at 1 (so "2026. 10. 12." inside a paragraph stays text). */
const interrupts = (line: string): boolean => {
  if (FENCE.test(line) || HEADING.test(line) || QUOTE.test(line)) return true;
  const m = ITEM.exec(line);
  return m !== null && (m[3] === undefined || m[3] === '1');
};

/** Emphasis starting at `at` (`**`/`__` strong, `*`/`_` em), or null when it does not open there or never closes. */
function emphasisAt(s: string, at: number): { node: Inline; end: number } | null {
  for (const size of [2, 1] as const) {
    const delim = s.slice(at, at + size);
    if (delim.length < size || [...delim].some((c) => c !== delim[0])) continue;
    const underscore = delim[0] === '_';
    const next = s[at + size];
    if (next === undefined || /\s/.test(next) || next === delim[0]) continue;
    // An underscore inside a word (snake_case) is part of the word.
    if (underscore && at > 0 && WORD.test(s[at - 1]!)) continue;
    for (let close = s.indexOf(delim, at + size + 1); close !== -1; close = s.indexOf(delim, close + 1)) {
      if (/\s/.test(s[close - 1]!)) continue;
      // A single closer is not half of a double one.
      if (size === 1 && (s[close + 1] === delim || s[close - 1] === delim)) continue;
      if (underscore && close + size < s.length && WORD.test(s[close + size]!)) continue;
      return { node: { kind: size === 2 ? 'strong' : 'em', children: parseInline(s.slice(at + size, close)) }, end: close + size };
    }
  }
  return null;
}

/** One line's inline content: code spans, cite tokens and emphasis; anything that does not close is text. */
function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf !== '') out.push({ kind: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'code', text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === '[') {
      const m = CITE_AT.exec(s.slice(i, i + 12));
      if (m) {
        flush();
        out.push({ kind: 'cite', pageIndex: Number(m[1]) - 1 });
        i += m[0].length;
        continue;
      }
    } else if (ch === '*' || ch === '_') {
      const em = emphasisAt(s, i);
      if (em) {
        flush();
        out.push(em.node);
        i = em.end;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Lines of one paragraph or item: each line's inline content, a break between them. */
function joinLines(lines: readonly string[]): Inline[] {
  return lines.flatMap((line, k) => (k === 0 ? parseInline(line.trim()) : [{ kind: 'break' } as Inline, ...parseInline(line.trim())]));
}

type ListBlock = Extract<AnswerBlock, { kind: 'list' }>;
type ListItem = ListBlock['items'][number];

/** A list held inside an item, at the second level: a list inside one of its items joins it, after that item. */
function secondLevel(list: ListBlock): ListBlock {
  const items: ListItem[] = [];
  for (const it of list.items) {
    const lists = [it.sub, ...(it.blocks ?? [])].filter((b): b is ListBlock => b !== null && b.kind === 'list');
    const rest = (it.blocks ?? []).filter((b) => b.kind !== 'list');
    items.push({ inline: it.inline, sub: null, ...(rest.length > 0 ? { blocks: rest } : {}) });
    for (const l of lists) items.push(...secondLevel(l).items);
  }
  return { ...list, items };
}

/** One item from its lines (its first line's text, then the lines under it with the item's indent taken off). */
function itemOf(body: readonly string[]): ListItem {
  let k = 1;
  while (k < body.length && !BLANK.test(body[k]!) && !interrupts(body[k]!)) k += 1;
  const blocks = parseLines(body.slice(k)).map((b) => (b.kind === 'list' ? secondLevel(b) : b));
  const sub = blocks[0]?.kind === 'list' ? blocks.shift()! : null;
  return { inline: joinLines(body.slice(0, k)), sub, ...(blocks.length > 0 ? { blocks } : {}) };
}

/**
 * A list from line `start`. An item holds the lines indented under it — at its text's column, or two spaces in where that is
 * deeper — blank lines between them included; a line that goes on right below its text without a blank line belongs to it too.
 * A blank line followed by a line further left ends the item; the list goes on while the next item is of its kind.
 */
function parseList(lines: readonly string[], start: number): [AnswerBlock, number] {
  const first = ITEM.exec(lines[start]!)!;
  const base = first[1]!.length;
  const ordered = first[3] !== undefined;
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!);
    if (m === null || m[1]!.length - base >= 2 || (m[3] !== undefined) !== ordered) break;
    const column = m[1]!.length + m[2]!.length + (m[4]!.length > 4 ? 1 : m[4]!.length);
    const under = Math.min(column, base + 2);
    const body = [m[5]!];
    let blank = false;
    i += 1;
    while (i < lines.length) {
      const line = lines[i]!;
      const indent = indentOf(line);
      if (BLANK.test(line)) {
        body.push('');
        blank = true;
      } else if (indent >= under) {
        body.push(line.slice(Math.min(indent, column)));
        blank = false;
      } else if (!blank && !ITEM.test(line) && !FENCE.test(line) && !HEADING.test(line) && !QUOTE.test(line)) {
        body.push(line); // a line that goes on from the item's text
      } else break;
      i += 1;
    }
    while (body.length > 1 && BLANK.test(body.at(-1)!)) body.pop();
    items.push(itemOf(body));
  }
  const number = Number(first[3]);
  return [{ kind: 'list', ordered, ...(ordered && number !== 1 ? { start: number } : {}), items }, i];
}

function parseLines(lines: readonly string[]): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (BLANK.test(line)) {
      i += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i += 1; // the closing fence, or past the end while it is still open
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'p', inline: [{ kind: 'strong', children: parseInline(heading[1]!.trim()) }] });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!);
      blocks.push({ kind: 'quote', blocks: parseLines(inner) });
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    const para = [line];
    i += 1;
    while (i < lines.length && !BLANK.test(lines[i]!) && !interrupts(lines[i]!)) para.push(lines[i++]!);
    blocks.push({ kind: 'p', inline: joinLines(para) });
  }
  return blocks;
}

export function parseAnswer(text: string): AnswerBlock[] {
  return parseLines(text.replace(/\r\n?/g, '\n').split('\n'));
}

/**
 * The finished blocks (memoised while streaming) and the last one (drawn again on each append). The cut is at the start of the last
 * block that follows a blank line outside a code fence — never inside an open fence, and never inside a list (between two of its
 * items, or before a line indented under one) — so the two halves parse to the blocks the whole answer has. Line ends are read as
 * parseAnswer reads them.
 */
export function splitStable(answer: string): { stable: string; tail: string } {
  const text = answer.replace(/\r\n?/g, '\n');
  let cut = 0;
  let offset = 0;
  let inFence = false;
  let inList = false;
  let blankBefore = false;
  for (const line of text.split('\n')) {
    const at = offset;
    offset += line.length + 1;
    if (inFence) {
      if (FENCE.test(line)) inFence = false;
      continue;
    }
    if (BLANK.test(line)) {
      blankBefore = true;
      continue;
    }
    const item = ITEM.test(line);
    const underItem: boolean = inList && (item || indentOf(line) >= 2);
    if (blankBefore && !underItem) cut = at;
    if (FENCE.test(line)) {
      inFence = true;
      inList = underItem;
    } else if (item) inList = true;
    else if ((blankBefore && !underItem) || HEADING.test(line) || QUOTE.test(line)) inList = underItem;
    blankBefore = false;
  }
  return { stable: text.slice(0, cut), tail: text.slice(cut) };
}
