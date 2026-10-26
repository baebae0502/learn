import { paletteLabel, type CommandContextState, type CommandId, type CommandSpec } from '@learn/domain';
import { MATCH_RANK, matchKorean, type Match } from './hangul';

export interface RankedCommand {
  command: CommandSpec;
  /** Where the query matched the label (for <mark>); null for keyword-only matches and the empty query. */
  match: Match | null;
}

/** Spec §4.4: with an empty query, the five commands run most recently from the palette head the list. */
export const RECENT_SHOWN = 5;

/**
 * Label matches by kind then position, then keyword-only matches; a tie goes to the command run more recently from the
 * palette (`recent`, newest first), then registry order. An empty query lists the RECENT_SHOWN most recent of
 * `commands` first, then the rest in registry order. The label is the one the palette shows: the state label for the
 * reported state (사이드바 가리기 / 사이드바 보기), as the menu and tooltip.
 */
export function rankCommands(
  commands: readonly CommandSpec[],
  query: string,
  platform: string,
  state: Pick<CommandContextState, 'sidebar' | 'inspector'> = {},
  recent: readonly CommandId[] = [],
): RankedCommand[] {
  if (query.trim() === '') {
    const top = recent.flatMap((id) => commands.filter((c) => c.id === id)).slice(0, RECENT_SHOWN);
    return [...top, ...commands.filter((c) => !top.includes(c))].map((command) => ({ command, match: null }));
  }
  const recency = (id: CommandId) => {
    const i = recent.indexOf(id);
    return i < 0 ? recent.length : i;
  };
  return commands
    .flatMap((command, index): Array<RankedCommand & { score: number; index: number }> => {
      const onLabel = matchKorean(query, paletteLabel(command, platform, state));
      if (onLabel) return [{ command, match: onLabel, score: MATCH_RANK[onLabel.kind] * 100 + onLabel.start, index }];
      const kinds = (command.keywords ?? []).flatMap((k) => {
        const m = matchKorean(query, k);
        return m ? [MATCH_RANK[m.kind]] : [];
      });
      return kinds.length ? [{ command, match: null, score: 1000 + Math.min(...kinds), index }] : [];
    })
    .sort((a, b) => a.score - b.score || recency(a.command.id) - recency(b.command.id) || a.index - b.index)
    .map(({ command, match }) => ({ command, match }));
}
