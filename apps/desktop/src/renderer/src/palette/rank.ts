import { commandLabel, type CommandContextState, type CommandSpec } from '@learn/domain';
import { MATCH_RANK, matchKorean, type Match } from './hangul';

export interface RankedCommand {
  command: CommandSpec;
  /** Where the query matched the label (for <mark>); null for keyword-only matches and the empty query. */
  match: Match | null;
}

/**
 * Label matches by kind then position, then keyword-only matches; ties keep registry order. The label is the one the
 * palette shows: the state label for the reported state (사이드바 가리기 / 사이드바 보기), as the menu and tooltip.
 */
export function rankCommands(
  commands: readonly CommandSpec[],
  query: string,
  platform: string,
  state: Pick<CommandContextState, 'sidebar' | 'inspector'> = {},
): RankedCommand[] {
  if (query.trim() === '') return commands.map((command) => ({ command, match: null }));
  return commands
    .flatMap((command, index): Array<RankedCommand & { score: number; index: number }> => {
      const onLabel = matchKorean(query, commandLabel(command, platform, state));
      if (onLabel) return [{ command, match: onLabel, score: MATCH_RANK[onLabel.kind] * 100 + onLabel.start, index }];
      const kinds = (command.keywords ?? []).flatMap((k) => {
        const m = matchKorean(query, k);
        return m ? [MATCH_RANK[m.kind]] : [];
      });
      return kinds.length ? [{ command, match: null, score: 1000 + Math.min(...kinds), index }] : [];
    })
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ command, match }) => ({ command, match }));
}
