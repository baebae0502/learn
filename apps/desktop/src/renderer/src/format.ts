import { t } from './strings';

/**
 * A file size in decimal units, as Finder shows it (macOS since 10.6) on every platform: 1 KB = 1000 B (critic
 * T14-n8; Finder에서 보기 is one click away). One decimal under 10, none above; a value that rounds up to 1000 moves
 * to the next unit ("1.0 MB", never "1000 KB").
 */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  /** The number as shown: one decimal while it reads under 10 once rounded, else whole. */
  const shown = (x: number) => (Number(x.toFixed(1)) < 10 ? x.toFixed(1) : x.toFixed(0));
  let v = bytes / 1000;
  let i = 0;
  while (Number(shown(v)) >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${shown(v)} ${units[i]}`;
}

/** The local calendar day of `d` (what 오늘/어제 compare). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** design-spec 9: "오늘 오전 9:24", "어제 오후 8:40", otherwise "2026. 10. 12.". */
export function formatDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t.common.noValue;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (dayKey(d) === dayKey(now)) return `${t.common.today} ${time}`;
  if (dayKey(d) === dayKey(yesterday)) return `${t.common.yesterday} ${time}`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** Milliseconds from `now` to the next local midnight, when "오늘" and "어제" move on (useNow). */
export function msUntilMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

/**
 * A path as shown on screen: inside the home folder it starts with "~" (mockup, Finder), anything else is unchanged.
 * Only the exact folder prefix counts (`/Users/a` never abbreviates `/Users/ab/…`); the full path stays in tooltips.
 */
export function homeRelative(p: string, home: string | null | undefined): string {
  const h = (home ?? '').replace(/[\\/]+$/, '');
  if (h === '') return p;
  if (p === h) return '~';
  const next = p.charAt(h.length);
  return p.startsWith(h) && (next === '/' || next === '\\') ? `~${p.slice(h.length)}` : p;
}
