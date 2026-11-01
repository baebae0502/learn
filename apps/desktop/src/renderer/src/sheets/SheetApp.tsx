import { useQuery } from '@tanstack/react-query';
import type { SheetResult } from '@learn/domain';
import { api, unwrap } from '../api';
import { DuplicateSheet } from './DuplicateSheet';
import { PurgeSheet } from './PurgeSheet';
import { ShortcutsSheet } from './ShortcutsSheet';

export const resolveSheet = (result: SheetResult): void => void api().sheet.resolve(result);

/** Renderer of a modal sheet window (?window=sheet). Main sizes the window to [data-sheet-root]. */
export function SheetApp() {
  const payload = useQuery({ queryKey: ['sheet', 'payload'], queryFn: () => unwrap(api().sheet.payload()) });
  if (!payload.data) return null;
  const p = payload.data;
  if (p.kind === 'duplicate') return <DuplicateSheet payload={p} />;
  if (p.kind === 'purge') return <PurgeSheet payload={p} />;
  return <ShortcutsSheet />;
}
