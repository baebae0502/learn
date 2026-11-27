import { SUBTITLE_LIMITS, languageTail, type Cue } from '@learn/domain';

const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/;

export function parseTimestamp(s: string): number | null {
  const m = TIMESTAMP.exec(s);
  if (!m) return null;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (minutes >= 60 || seconds >= 60) return null;
  const frac = m[4] === undefined ? 0 : Number(m[4].padEnd(3, '0'));
  return (Number(m[1] ?? 0) * 3600 + minutes * 60 + seconds) * 1000 + frac;
}

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['#39', "'"], ['nbsp', '\u00a0'], ['lrm', '\u200e'], ['rlm', '\u200f'],
]);

function entity(whole: string, body: string): string {
  const named = ENTITIES.get(body);
  if (named !== undefined) return named;
  const m = /^#(?:(\d+)|x([0-9a-fA-F]+))$/.exec(body);
  if (!m) return whole;
  const cp = m[1] !== undefined ? Number(m[1]) : parseInt(m[2]!, 16);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return whole;
  return String.fromCodePoint(cp);
}

const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/**
 * One forward pass that drops real tags (a name, or a time tag such as `<00:00:01.000>`), ruby annotations and `{\...}`
 * overrides. A `<` that is not a tag, such as "3 < 5", stays. Every search that fails is remembered, so a text full of
 * unclosed openers is still read once.
 */
function stripMarkup(raw: string): string {
  const out: string[] = [];
  const closers = { rt: /<\/rt>/gi, rp: /<\/rp>/gi };
  const absent = { rt: false, rp: false, brace: false };
  let last = 0;
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw.charCodeAt(i);
    if (ch === 0x7b && raw.charCodeAt(i + 1) === 0x5c && !absent.brace) {
      const close = raw.indexOf('}', i + 2);
      if (close < 0) {
        absent.brace = true;
      } else {
        out.push(raw.slice(last, i));
        last = i = close + 1;
        continue;
      }
    } else if (ch === 0x3c) {
      const first = raw.charCodeAt(i + 1);
      const nameAt = first === 0x2f ? i + 2 : i + 1;
      const c = raw.charCodeAt(nameAt);
      if (isLetter(c) || (first !== 0x2f && isDigit(c))) {
        let j = nameAt;
        while (j < n) {
          const x = raw.charCodeAt(j);
          if (x === 0x3e || x === 0x3c || x === 0x0a || x === 0x0d) break;
          j++;
        }
        if (j < n && raw.charCodeAt(j) === 0x3e) {
          const inner = raw.slice(nameAt, j);
          const timeTag = isDigit(c) && /^[\d:.,]+$/.test(inner);
          if (isLetter(c) || timeTag) {
            out.push(raw.slice(last, i));
            let end = j + 1;
            const name = first === 0x2f ? '' : /^[A-Za-z]+/.exec(inner)?.[0].toLowerCase();
            if ((name === 'rt' || name === 'rp') && !absent[name]) {
              const re = closers[name];
              re.lastIndex = end;
              const m = re.exec(raw);
              if (m) end = m.index + m[0].length;
              else absent[name] = true;
            }
            last = i = end;
            continue;
          }
        }
      }
    }
    i++;
  }
  out.push(raw.slice(last));
  return out.join('');
}

/** Cue markup to plain text: tags, ruby annotations and ASS overrides removed, entities decoded, at most three lines and 1,000 characters. */
export function cleanCueText(raw: string): string {
  const stripped = stripMarkup(raw).replace(/&(#\d+|#x[0-9a-fA-F]+|[A-Za-z]+);/g, entity);
  const lines = splitLines(stripped)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length > SUBTITLE_LIMITS.lines) {
    lines.splice(SUBTITLE_LIMITS.lines - 1, lines.length, lines.slice(SUBTITLE_LIMITS.lines - 1).join(' '));
  }
  const text = lines.join('\n');
  if (text.length <= SUBTITLE_LIMITS.cueChars - 1) return text;
  // Count code points only as far as the cut needs, so a huge cue is not spread into an array.
  let points = 0;
  let at = 0;
  let cut = -1;
  while (at < text.length && points <= SUBTITLE_LIMITS.cueChars) {
    if (points === SUBTITLE_LIMITS.cueChars - 1) cut = at;
    at += text.codePointAt(at)! > 0xffff ? 2 : 1;
    points++;
  }
  return points > SUBTITLE_LIMITS.cueChars ? text.slice(0, cut) + '\u2026' : text;
}

const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/);
const isBlank = (l: string): boolean => l.trim() === '';

type Times = { startMs: number; endMs: number };

/** The two times of a time line; any other line, even one holding `-->`, is cue text. Settings after the end time are dropped. */
function timeLine(line: string): Times | null {
  const at = line.indexOf('-->');
  if (at < 0) return null;
  const start = parseTimestamp(line.slice(0, at).trim());
  if (start === null) return null;
  const end = parseTimestamp(/^\S*/.exec(line.slice(at + 3).trimStart())![0]);
  return end === null ? null : { startMs: start, endMs: end };
}

function makeCue(times: Times, lines: string[]): Cue | null {
  const { startMs, endMs } = times;
  if (startMs >= SUBTITLE_LIMITS.maxMs || endMs >= SUBTITLE_LIMITS.maxMs || endMs <= startMs) return null;
  const text = cleanCueText(lines.join('\n'));
  return text === '' ? null : { startMs, endMs, text };
}

/** Collects cues from lines; a time line opens a cue, a blank line closes it, and `full` turns true once `maxCues` is passed. */
class CueCollector {
  readonly cues: Cue[] = [];
  private times: Times | null = null;
  private body: string[] = [];

  constructor(private readonly maxCues: number) {}

  get full(): boolean {
    return this.cues.length > this.maxCues;
  }
  get open(): boolean {
    return this.times !== null;
  }
  /** A bare number right before a time line that follows cue text with no blank line is the next block's index. */
  start(times: Times): void {
    if (this.times !== null && this.body.length > 0 && /^\d+$/.test(this.body[this.body.length - 1]!.trim())) this.body.pop();
    this.close();
    this.times = times;
  }
  add(line: string): void {
    this.body.push(line);
  }
  close(): void {
    if (this.times !== null) {
      const cue = makeCue(this.times, this.body);
      if (cue) this.cues.push(cue);
    }
    this.times = null;
    this.body = [];
  }
}

export function parseSrt(text: string, maxCues = Infinity): Cue[] {
  const c = new CueCollector(maxCues);
  for (const line of splitLines(text)) {
    const times = line.includes('-->') ? timeLine(line) : null;
    if (times) c.start(times);
    else if (isBlank(line)) c.close();
    else if (c.open) c.add(line);
    if (c.full) break;
  }
  c.close();
  return c.cues;
}

export function parseVtt(text: string, maxCues = Infinity): { cues: Cue[]; language: string | null } {
  const lines = splitLines(text.replace(/^\s+/, ''));
  let i = 0;
  let language: string | null = null;
  for (; i < lines.length && !isBlank(lines[i]!) && timeLine(lines[i]!) === null; i++) {
    const m = /^Language:\s*(\S+)\s*$/i.exec(lines[i]!);
    if (m && language === null) language = languageTail(`x.${m[1]}`).language;
  }
  const c = new CueCollector(maxCues);
  let skipping = false;
  let blockStart = true;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (isBlank(line)) {
      c.close();
      skipping = false;
      blockStart = true;
      continue;
    }
    const times = skipping ? null : timeLine(line);
    if (times) c.start(times);
    else if (c.open) c.add(line);
    else if (blockStart && /^(NOTE|STYLE|REGION)(\s|$)/.test(line)) skipping = true;
    blockStart = false;
    if (c.full) break;
  }
  c.close();
  return { cues: c.cues, language };
}
