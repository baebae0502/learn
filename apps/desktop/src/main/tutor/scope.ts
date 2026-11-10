import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PdfSpanAnchor } from '@learn/domain';
import { newNonce } from './boundary';

/** The outline as the reader resolved it when the question was sent: its first entries, and whether every page is known. */
export interface OutlineSnapshot { entries: Array<{ title: string; depth: number; pageIndex: number | null }>; complete: boolean; total: number }
export interface TurnSelection { anchor: PdfSpanAnchor; text: string }
/** The question being answered: the answer's message, the passage it carried and the new pages its tools returned. */
export interface ActiveTurn { tutorMessageId: string; selection: TurnSelection | null; pagesReturned: number }

/** What one ACP session may read, held in main's memory only: gone with the session, never kept across a restart. */
export interface AcpScope {
  readonly token: string;
  readonly nonce: string;
  readonly conversationId: string;
  readonly itemId: string;
  readonly revisionId: string;
  readonly sha256: string;
  readonly title: string;
  /** The reader's numbers for the question being answered: pdf.js's page count, the outline it resolved, and the 0-based page it showed. */
  pageCount: number;
  outline: OutlineSnapshot;
  readerPage: number;
  activeTurn: ActiveTurn | null;
  /** The 0-based pages this ACP session's tools returned with their text. */
  readonly returnedPages: Set<number>;
  /** Whether the token is bound to the MCP session it opened (the transport sets it at initialize); off for an agent whose catalog says so. */
  readonly bindMcpSession: boolean;
  mcpSessionId: string | null;
}

export interface ScopeRegistry {
  open(init: Omit<AcpScope, 'token' | 'nonce' | 'returnedPages' | 'activeTurn' | 'mcpSessionId'>): AcpScope;
  find(token: string): AcpScope | null;
  close(token: string): void;
  size(): number;
}

const TOKEN_BYTES = 32;

export function createScopeRegistry(): ScopeRegistry {
  const scopes = new Map<string, AcpScope>();
  return {
    open(init) {
      const scope: AcpScope = {
        ...init, token: randomBytes(TOKEN_BYTES).toString('hex'), nonce: newNonce(), activeTurn: null, returnedPages: new Set(), mcpSessionId: null,
      };
      scopes.set(scope.token, scope);
      return scope;
    },
    find(token) {
      const given = Buffer.from(String(token), 'utf8');
      // A token's length is no secret; its bytes are compared with every live token, without stopping at a match.
      if (given.length !== TOKEN_BYTES * 2) return null;
      let hit: AcpScope | null = null;
      for (const [known, scope] of scopes) {
        if (timingSafeEqual(given, Buffer.from(known, 'utf8'))) hit = scope;
      }
      return hit;
    },
    close(token) {
      scopes.delete(token);
    },
    size: () => scopes.size,
  };
}

export type Guard = { ok: true } | { ok: false; code: 'OUT_OF_SCOPE' | 'NO_TURN' };

const inDocument = (n: number | undefined, pageCount: number): boolean => n === undefined || (Number.isInteger(n) && n >= 1 && n <= pageCount);

/** What a tool call asks for: this scope's item, pages of the document (1-based), and a question to answer. */
export function guardToolArgs(scope: AcpScope, args: { item?: string; from?: number; to?: number }): Guard {
  // Checked first: with no answer to put it on, even a refusal cannot be recorded.
  if (scope.activeTurn === null) return { ok: false, code: 'NO_TURN' };
  if (args.item !== undefined && args.item !== scope.itemId) return { ok: false, code: 'OUT_OF_SCOPE' };
  if (!inDocument(args.from, scope.pageCount) || !inDocument(args.to, scope.pageCount)) return { ok: false, code: 'OUT_OF_SCOPE' };
  return { ok: true };
}

/** The passage a prompt carries comes from the revision this scope reads. */
export function guardPromptSelection(scope: Pick<AcpScope, 'revisionId'>, selection: TurnSelection | null): Guard {
  if (selection !== null && selection.anchor.revisionId !== scope.revisionId) return { ok: false, code: 'OUT_OF_SCOPE' };
  return { ok: true };
}
