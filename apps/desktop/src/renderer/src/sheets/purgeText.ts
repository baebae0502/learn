import type { SheetPayload } from '@learn/domain';
import { t } from '../strings';

export type PurgePayload = Extract<SheetPayload, { kind: 'purge' }>;

/** The purge sheet's words for a payload (P-25, spec 4.5 as the owner approved it): what goes, what stays, the verb. */
export function purgeText(p: PurgePayload): { title: string; body: string; verb: string } {
  const s = t.sheets.purge;
  const text = (body: string) => withSessions(body, p);
  switch (p.variant) {
    case 'items':
      return { title: s.titleItems(p.items, p.name), body: text(s.bodyItems), verb: s.purge };
    case 'collections':
      return { title: s.titleCollections(p.collections, p.name), body: text(s.bodyCollections), verb: s.purge };
    case 'mixed':
      return { title: s.titleMixed(p.items, p.collections), body: text(s.bodyMixed), verb: s.purge };
    case 'empty':
      return { title: s.titleEmpty, body: text(s.bodyEmpty(s.what(p.items, p.collections))), verb: s.empty };
  }
}

/** The text, and after it the tutor sessions that go with the items when main counted some (T1a spec 6.2, 13). */
function withSessions(body: string, p: PurgePayload): string {
  const n = p.sessions ?? 0;
  if (n === 0) return body;
  const s = t.sheets.purge;
  const sentence = p.variant === 'empty' ? s.sessionsTrash(n) : p.items === 1 ? s.sessionsOne(n) : s.sessionsMany(p.sessionItems ?? 0, n);
  return `${body} ${sentence}`;
}
