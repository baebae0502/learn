import type { SheetPayload } from '@learn/domain';
import { t } from '../strings';

export type PurgePayload = Extract<SheetPayload, { kind: 'purge' }>;

/** The purge sheet's words for a payload (P-25, spec 4.5 as the owner approved it): what goes, what stays, the verb. */
export function purgeText(p: PurgePayload): { title: string; body: string; verb: string } {
  const s = t.sheets.purge;
  switch (p.variant) {
    case 'items':
      return { title: s.titleItems(p.items), body: s.bodyItems, verb: s.purge };
    case 'collections':
      return { title: s.titleCollections(p.collections), body: s.bodyCollections, verb: s.purge };
    case 'mixed':
      return { title: s.titleMixed(p.items, p.collections), body: s.bodyMixed, verb: s.purge };
    case 'empty':
      return { title: s.titleEmpty, body: s.bodyEmpty(s.what(p.items, p.collections)), verb: s.empty };
  }
}
