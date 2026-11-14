import type { SessionSummary } from '@learn/domain';
import { dayKey } from '../../format';
import { t } from '../../strings';

/** The day a session belongs to in the list: the local day it was last talked in (the list's order). */
const dayOf = (s: SessionSummary): Date => new Date(s.updatedAt);

/** A day group's name (design-spec 9's dates): "오늘", "어제", else "2026. 10. 12.". */
function dayLabel(d: Date, now: Date): string {
  if (dayKey(d) === dayKey(now)) return t.common.today;
  if (dayKey(d) === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return t.common.yesterday;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/**
 * The reader's 세션 pane (T1a spec 8.9): the sessions by the local day they were last talked in, newest day first, each day's
 * newest first; sessions of the same moment keep the order they came in.
 */
export function sessionGroups(sessions: readonly SessionSummary[], now: Date): Array<{ label: string; sessions: SessionSummary[] }> {
  const ordered = sessions.map((s, i) => ({ s, at: dayOf(s).getTime(), i })).sort((a, b) => b.at - a.at || a.i - b.i);
  const groups: Array<{ key: string; label: string; sessions: SessionSummary[] }> = [];
  for (const { s, at } of ordered) {
    const d = new Date(at);
    const key = dayKey(d);
    const last = groups.at(-1);
    if (last?.key === key) last.sessions.push(s);
    else groups.push({ key, label: dayLabel(d, now), sessions: [s] });
  }
  return groups.map(({ label, sessions: list }) => ({ label, sessions: list }));
}
