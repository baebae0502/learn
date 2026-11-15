import { describe, expect, it } from 'vitest';
import { newId, type PdfSpanAnchor } from '@learn/domain';
import { createScopeRegistry, guardPromptSelection, guardToolArgs, type AcpScope, type ScopeRegistry } from './scope';

const ITEM = newId();
const REVISION = newId();
const OTHER_ITEM = newId();
const OTHER_REVISION = newId();
const MSG = newId();
const INIT: Parameters<ScopeRegistry['open']>[0] = {
  conversationId: newId(), itemId: ITEM, revisionId: REVISION, sha256: 'c'.repeat(64), title: 'A paper',
  pageCount: 12, outline: { entries: [], complete: true, total: 0 }, readerPage: 0, bindMcpSession: true,
};
const spanIn = (revisionId: string): PdfSpanAnchor => ({
  kind: 'pdf', revisionId, precision: 'span', pageIndex: 3, quads: [[0, 0, 1, 0, 0, 1, 1, 1]], coordinateSpace: 'pdf-user-space',
  text: { quote: { exact: 'q', prefix: '', suffix: '' } },
});

describe('the scope registry', () => {
  it('a 256-bit token per ACP session, found in constant time, gone when closed', () => {
    const reg = createScopeRegistry();
    const s = reg.open(INIT);
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
    expect(s.nonce).toMatch(/^[0-9a-f]{12}$/);
    expect(reg.find(s.token)).toBe(s);
    expect(reg.find(`${s.token.slice(0, 63)}${s.token.endsWith('0') ? '1' : '0'}`)).toBeNull();
    expect(reg.find('short')).toBeNull();
    reg.close(s.token);
    expect(reg.find(s.token)).toBeNull();
    expect(reg.open(INIT).nonce).not.toBe(s.nonce);
  });

  it('opens a scope with no turn, nothing returned yet and no MCP session; several live side by side', () => {
    const reg = createScopeRegistry();
    const a = reg.open(INIT);
    const b = reg.open({ ...INIT, conversationId: newId(), bindMcpSession: false });
    expect(a).toMatchObject({ ...INIT, activeTurn: null, mcpSessionId: null });
    expect(a.returnedPages.size).toBe(0);
    expect(b.bindMcpSession).toBe(false);
    expect(a.token).not.toBe(b.token);
    expect(reg.size()).toBe(2);
    expect(reg.find(b.token)).toBe(b);
    expect(reg.find(`${a.token}0`)).toBeNull(); // a longer token is not a prefix match
    expect(reg.find(a.token.toUpperCase())).toBeNull();
    reg.close(a.token);
    expect(reg.size()).toBe(1);
    expect(reg.find(b.token)).toBe(b);
  });

  it('closing a scope ends its turn, so a tool call still running finds no question to keep its result for', () => {
    const reg = createScopeRegistry();
    const s = reg.open(INIT);
    s.activeTurn = { tutorMessageId: MSG, selection: null, pagesReturned: 3 };
    reg.close(s.token);
    expect(s.activeTurn).toBeNull();
    expect(reg.find(s.token)).toBeNull();
  });
});

describe('the guard', () => {
  it('refuses another item, a page outside the document and a call with no turn', () => {
    const s = createScopeRegistry().open({ ...INIT, pageCount: 120 });
    expect(guardToolArgs(s, {})).toEqual({ ok: false, code: 'NO_TURN' });
    s.activeTurn = { tutorMessageId: MSG, selection: null, pagesReturned: 0 };
    expect(guardToolArgs(s, { from: 1, to: 120 })).toEqual({ ok: true });
    expect(guardToolArgs(s, { item: OTHER_ITEM, from: 1 })).toEqual({ ok: false, code: 'OUT_OF_SCOPE' });
    expect(guardToolArgs(s, { from: 121 })).toEqual({ ok: false, code: 'OUT_OF_SCOPE' });
    expect(guardToolArgs(s, { from: 0 })).toEqual({ ok: false, code: 'OUT_OF_SCOPE' });
    expect(guardPromptSelection(s, { anchor: spanIn(OTHER_REVISION), text: 'q' })).toEqual({ ok: false, code: 'OUT_OF_SCOPE' });
  });

  it('lets this item through by its id, checks the end of a range too, and a call with no turn is NO_TURN whatever it asks', () => {
    const s: AcpScope = createScopeRegistry().open({ ...INIT, pageCount: 120 });
    expect(guardToolArgs(s, { item: OTHER_ITEM, from: 500 })).toEqual({ ok: false, code: 'NO_TURN' }); // nothing to record it on
    s.activeTurn = { tutorMessageId: MSG, selection: null, pagesReturned: 0 };
    expect(guardToolArgs(s, {})).toEqual({ ok: true });
    expect(guardToolArgs(s, { item: ITEM, from: 120 })).toEqual({ ok: true });
    expect(guardToolArgs(s, { from: 1, to: 121 })).toEqual({ ok: false, code: 'OUT_OF_SCOPE' });
    expect(guardToolArgs(s, { from: 1.5 })).toEqual({ ok: false, code: 'OUT_OF_SCOPE' });
    expect(guardPromptSelection(s, null)).toEqual({ ok: true });
    expect(guardPromptSelection(s, { anchor: spanIn(REVISION), text: 'q' })).toEqual({ ok: true });
  });
});
