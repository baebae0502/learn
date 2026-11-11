import { LearnError, type ToolChip, type TutorTool, type TutorTurnEvent } from '@learn/domain';
import type { ConversationsRepository } from '@learn/db';
import { tutorLog } from './log';
import type { AcpScope } from './scope';
import { callTool, type ToolCallResult, type ToolDeps } from './tools';

export interface TutorCallDeps {
  deps: ToolDeps;
  conversations(): Pick<ConversationsRepository, 'addToolRead'>;
  emitTurn(e: TutorTurnEvent): void;
  now(): string;
}

const codeOf = (e: unknown): string => (e instanceof LearnError ? e.code : e instanceof Error ? e.name : 'UNKNOWN');

/**
 * Learn's MCP server calls a tool through this. The read is kept on the answer of the question that was being answered
 * when the call came in; callTool says (read: null) when that question ended before the result was ready, and then
 * nothing is kept. The main window sees the chip running, then the chip as it was recorded.
 */
export function createTutorCall(d: TutorCallDeps): (scope: AcpScope, name: TutorTool, args: unknown) => Promise<ToolCallResult> {
  return async (scope, name, args) => {
    const turn = scope.activeTurn;
    const tell = (chip: ToolChip, running: boolean) => {
      if (turn === null) return;
      try {
        d.emitTurn({ conversationId: scope.conversationId, messageId: turn.tutorMessageId, kind: 'tool', chip, running });
      } catch (e) {
        tutorLog('emit-failed', { code: codeOf(e) });
      }
    };
    const r = await callTool(scope, name, args, d.deps, (chip) => tell(chip, true));
    if (r.read !== null && turn !== null) {
      let chip: ToolChip;
      try {
        chip = d.conversations().addToolRead(turn.tutorMessageId, r.read, d.now());
      } catch (e) {
        // The answer's row went (a quit, a failure before the answer): the agent still gets its pages.
        tutorLog('tool-read-failed', { code: codeOf(e) });
        return r;
      }
      tell(chip, false);
    }
    return r;
  };
}
