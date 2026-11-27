import { SUBTITLE_LIMITS, fileStem, languageTail, subtitleFormatOf, type Cue, type SubtitleEncoding, type SubtitleFailure, type SubtitleFormat } from '@learn/domain';
import { decodeSubtitleBytes } from './decode';
import { parseSrt, parseVtt } from './parse';

export type SubtitleResult =
  | { ok: true; format: SubtitleFormat; encoding: SubtitleEncoding; language: string | null; cues: Cue[] }
  | { ok: false; reason: SubtitleFailure };

/** Reads a subtitle file's bytes within the limits; the name only supplies the language tail, the format comes from the content. */
export function readSubtitle(bytes: Uint8Array, name: string): SubtitleResult {
  if (bytes.length > SUBTITLE_LIMITS.bytes) return { ok: false, reason: 'too-large' };
  const decoded = decodeSubtitleBytes(bytes);
  if (decoded === null) return { ok: false, reason: 'unreadable' };
  const isVtt = /^\s*WEBVTT/.test(decoded.text);
  const format: SubtitleFormat = isVtt ? 'vtt' : 'srt';
  let cues: Cue[];
  let headLanguage: string | null = null;
  if (isVtt) {
    const v = parseVtt(decoded.text, SUBTITLE_LIMITS.cues);
    cues = v.cues;
    headLanguage = v.language;
  } else {
    cues = parseSrt(decoded.text, SUBTITLE_LIMITS.cues);
  }
  if (cues.length > SUBTITLE_LIMITS.cues) return { ok: false, reason: 'too-many-cues' };
  if (cues.length === 0) return { ok: false, reason: 'no-cues' };
  cues.sort((a, b) => a.startMs - b.startMs);
  const language = languageTail(fileStem(name)).language ?? headLanguage;
  return { ok: true, format, encoding: decoded.encoding, language, cues };
}
