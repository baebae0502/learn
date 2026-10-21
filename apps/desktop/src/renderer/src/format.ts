import { t } from './strings';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
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
