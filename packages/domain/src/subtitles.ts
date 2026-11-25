export const SUBTITLE_EXTENSIONS = ['srt', 'vtt'] as const;
export type SubtitleFormat = (typeof SUBTITLE_EXTENSIONS)[number];
export const SUBTITLE_MIMES: Readonly<Record<SubtitleFormat, string>> = { srt: 'application/x-subrip', vtt: 'text/vtt' };
export const SUBTITLE_LIMITS = { bytes: 5 * 1024 * 1024, cues: 20_000, cueChars: 1_000, lines: 3, maxMs: 24 * 3_600_000 } as const;
export type SubtitleEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'cp949';
export type SubtitleFailure = 'unreadable' | 'no-cues' | 'too-large' | 'too-many-cues';
export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

const lastSegment = (name: string): string => name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);

/** By the name's extension (case-insensitive): what the attach routes filter on; the parser judges by content. */
export function subtitleFormatOf(name: string): SubtitleFormat | null {
  const seg = lastSegment(name);
  const dot = seg.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = seg.slice(dot + 1).toLowerCase();
  return (SUBTITLE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SubtitleFormat) : null;
}

/** The file name without its last extension, NFC (both `/` and `\` separate folders). */
export function fileStem(name: string): string {
  const seg = lastSegment(name);
  const dot = seg.lastIndexOf('.');
  return (dot > 0 ? seg.slice(0, dot) : seg).normalize('NFC');
}

const THREE_LETTER: Readonly<Record<string, string>> = {
  kor: 'ko', eng: 'en', jpn: 'ja', zho: 'zh', chi: 'zh', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr', spa: 'es',
};
const TAIL = /^([A-Za-z]{2}|[A-Za-z]{3})(-[A-Za-z0-9]{2,8})*$/;

/** `강의.ko` gives language `ko`, `lecture.en-us` gives `en-US`, `강의.kor` gives `ko`, and `강의.v2` has no language. */
export function languageTail(stem: string): { base: string; language: string | null } {
  const dot = stem.lastIndexOf('.');
  const none = { base: stem, language: null };
  if (dot <= 0) return none;
  const tail = stem.slice(dot + 1);
  if (tail.length < 2 || tail.length > 35) return none;
  const m = TAIL.exec(tail);
  if (!m) return none;
  const [primary, ...rest] = tail.split('-') as [string, ...string[]];
  const lower = primary.toLowerCase();
  const lang = primary.length === 2 ? lower : THREE_LETTER[lower];
  if (lang === undefined) return none;
  const region = rest.map((r) => (/^[A-Za-z]{2}$/.test(r) ? r.toUpperCase() : r));
  return { base: stem.slice(0, dot), language: [lang, ...region].join('-') };
}
