import { useQuery } from '@tanstack/react-query';
import { COMMAND_IDS, type CommandId } from '@learn/domain';
import { ApiError, api, unwrap } from '../api';
import { queryClient } from '../data/query-client';

/** The library setting (ADR-0007 (b)) and its cache entry. */
export const RECENT_KEY = ['settings', 'palette.recent'] as const;
/** As many as palette.recent keeps (domain settings.ts). */
export const RECENT_MAX = 20;
const KNOWN: ReadonlySet<string> = new Set(COMMAND_IDS);
const NONE: readonly CommandId[] = [];

/** Known command ids only, once each, at most RECENT_MAX; anything else reads as no history. */
export function parseRecent(raw: unknown): CommandId[] {
  if (!Array.isArray(raw)) return [];
  const out: CommandId[] = [];
  for (const v of raw) if (typeof v === 'string' && KNOWN.has(v) && !out.includes(v as CommandId)) out.push(v as CommandId);
  return out.slice(0, RECENT_MAX);
}

/** `id` first, once; the RECENT_MAX newest kept. */
export const withRecent = (recent: readonly CommandId[], id: CommandId): CommandId[] => [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);

/** A command run from the palette goes to the head of the history at once (the cache), then to the library (logged by code only when that fails). */
export function rememberRecent(id: CommandId): void {
  const next = withRecent(queryClient.getQueryData<CommandId[]>(RECENT_KEY) ?? NONE, id);
  queryClient.setQueryData(RECENT_KEY, next);
  void unwrap(api().settings.set({ key: 'palette.recent', value: next })).catch((e: unknown) => {
    console.warn(`[palette] saving palette.recent failed: ${e instanceof ApiError ? e.code : 'INTERNAL'}`);
  });
}

/** The palette's history; read once, at start-up (an unreadable one is none). */
export function usePaletteRecent(): { ids: readonly CommandId[]; remember(id: CommandId): void } {
  const q = useQuery({ queryKey: RECENT_KEY, queryFn: async () => parseRecent(await unwrap(api().settings.get({ key: 'palette.recent' }))) });
  return { ids: q.data ?? NONE, remember: rememberRecent };
}
