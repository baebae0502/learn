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

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', lrm: '‎', rlm: '‏',
};

function entity(whole: string, body: string): string {
  const named = ENTITIES[body];
  if (named !== undefined) return named;
  const m = /^#(?:(\d+)|x([0-9a-fA-F]+))$/.exec(body);
  if (!m) return whole;
  const cp = m[1] !== undefined ? Number(m[1]) : parseInt(m[2]!, 16);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return whole;
  return String.fromCodePoint(cp);
}

// Edge whitespace is trimmed except U+00A0, which an &nbsp; put there on purpose.
const EDGE = /^[^\S ]+|[^\S ]+$/g;

/** Cue markup to plain text: tags, ruby annotations and ASS overrides removed, entities decoded, at most three lines and 1,000 characters. */
export function cleanCueText(raw: string): string {
  const stripped = raw
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-fA-F]+|[A-Za-z]+);/g, entity);
  const lines = stripped
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(EDGE, ''))
    .filter((l) => l.trim() !== '');
  if (lines.length > SUBTITLE_LIMITS.lines) {
    lines.splice(SUBTITLE_LIMITS.lines - 1, lines.length, lines.slice(SUBTITLE_LIMITS.lines - 1).join(' '));
  }
  let text = lines.join('\n');
  const points = [...text];
  if (points.length > SUBTITLE_LIMITS.cueChars) text = points.slice(0, SUBTITLE_LIMITS.cueChars - 1).join('') + '…';
  return text;
}

const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/);
const isBlank = (l: string): boolean => l.trim() === '';

/** The two times of a `-->` line, or null when either is malformed; settings after the end time are dropped. */
function timeLine(line: string): { startMs: number; endMs: number } | null {
  const at = line.indexOf('-->');
  const start = parseTimestamp(line.slice(0, at).trim());
  const end = parseTimestamp(line.slice(at + 3).trim().split(/\s+/)[0] ?? '');
  if (start === null || end === null) return null;
  return { startMs: start, endMs: end };
}

function makeCue(times: { startMs: number; endMs: number } | null, lines: string[]): Cue | null {
  if (times === null) return null;
  const { startMs, endMs } = times;
  if (startMs >= SUBTITLE_LIMITS.maxMs || endMs >= SUBTITLE_LIMITS.maxMs || endMs <= startMs) return null;
  const text = cleanCueText(lines.join('\n'));
  return text === '' ? null : { startMs, endMs, text };
}

export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  let times: { startMs: number; endMs: number } | null = null;
  let body: string[] | null = null;
  const flush = (dropNumber: boolean): void => {
    if (body === null) return;
    // A bare number right before the next time line is that block's index, even with no blank line between.
    if (dropNumber && body.length > 0 && /^\s*\d+\s*$/.test(body[body.length - 1]!)) body.pop();
    const cue = makeCue(times, body);
    if (cue) cues.push(cue);
    body = null;
  };
  for (const line of splitLines(text)) {
    if (line.includes('-->')) {
      flush(true);
      times = timeLine(line);
      body = [];
    } else if (isBlank(line)) {
      flush(false);
    } else if (body !== null) {
      body.push(line);
    }
  }
  flush(false);
  return cues;
}

export function parseVtt(text: string): { cues: Cue[]; language: string | null } {
  const lines = splitLines(text.replace(/^[﻿\s]+/, ''));
  let i = 0;
  let language: string | null = null;
  for (; i < lines.length && !isBlank(lines[i]!); i++) {
    const m = /^Language:\s*(\S+)\s*$/i.exec(lines[i]!);
    if (m && language === null) language = languageTail(`x.${m[1]}`).language;
  }
  const cues: Cue[] = [];
  let block: string[] = [];
  const endBlock = (): void => {
    const first = block[0];
    if (first !== undefined && !/^(NOTE|STYLE|REGION)(\s|$)/.test(first)) {
      const at = block.findIndex((l) => l.includes('-->'));
      if (at >= 0) {
        const cue = makeCue(timeLine(block[at]!), block.slice(at + 1));
        if (cue) cues.push(cue);
      }
    }
    block = [];
  };
  for (; i < lines.length; i++) {
    if (isBlank(lines[i]!)) endBlock();
    else block.push(lines[i]!);
  }
  endBlock();
  return { cues, language };
}
