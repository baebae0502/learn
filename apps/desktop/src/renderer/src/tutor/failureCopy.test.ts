import { describe, expect, it } from 'vitest';
import type { CitationCheck, MessageStatus } from '@learn/domain';
import { answerCheck, canReground, failureCopy, failureTone, knownPageCount, regroundBubble, unverifiedForm } from './failureCopy';
import { t } from '../strings';

const CLAUDE = 'Claude Code';
const CMD = 'CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Learn/Tutor/agents/claude" claude auth login';
const claude = { agent: 'claude' as const, loginCommand: null };

describe('what a failed turn says (spec 8.8, 13; the approved mockup ?state=8&fail=…)', () => {
  it('before any answer: the agent stopped — the question is back in the composer, ↩ sends it again', () => {
    expect(failureCopy({ code: 'AGENT_EXITED', phase: 'before', ...claude })).toEqual({
      title: `${CLAUDE}가 답하기 전에 멈췄습니다`,
      body: '답을 받지 못했습니다. 잠시 뒤 입력창에서 ↩\u2060로 다시 보내세요. 질문은 입력창에 그대로 있습니다.',
      actions: [],
      command: null,
    });
    expect(failureCopy({ code: 'AGENT_PROTOCOL', phase: 'before', ...claude })).toEqual(failureCopy({ code: 'AGENT_EXITED', phase: 'before', ...claude }));
  });
  it('before any answer: offline, not answering in time', () => {
    expect(failureCopy({ code: 'OFFLINE', phase: 'before', ...claude })).toEqual({
      title: '인터넷에 연결되어 있지 않습니다',
      body: '질문을 보내지 못했습니다. 연결을 확인한 뒤 입력창에서 ↩\u2060로 보내세요. 질문은 입력창에 그대로 있습니다.',
      actions: [],
      command: null,
    });
    expect(failureCopy({ code: 'AGENT_TIMEOUT', phase: 'before', ...claude })).toEqual({
      title: `${CLAUDE}가 답하지 않습니다`,
      body: '답을 받지 못했습니다. 잠시 뒤 입력창에서 ↩\u2060로 다시 보내세요. 질문은 입력창에 그대로 있습니다.',
      actions: [],
      command: null,
    });
  });
  it('before any answer: the login, with its command to copy (the chooser\'s own)', () => {
    expect(failureCopy({ code: 'AGENT_LOGIN', phase: 'before', agent: 'claude', loginCommand: CMD })).toEqual({
      title: `${CLAUDE} 로그인이 필요합니다`,
      body: '질문을 보내지 못했습니다. 터미널에서 아래 명령으로 로그인한 뒤 입력창에서 ↩\u2060로 보내세요. 질문은 입력창에 그대로 있습니다.',
      actions: ['copy-login'],
      command: CMD,
    });
    // The report not read again yet: the button waits for the command, which is never made up.
    expect(failureCopy({ code: 'AGENT_LOGIN', phase: 'before', ...claude }).command).toBeNull();
    // Any other failure carries no command, whatever the report holds.
    expect(failureCopy({ code: 'OFFLINE', phase: 'before', agent: 'claude', loginCommand: CMD }).command).toBeNull();
  });
  it('before any answer: not ready or not started — 에이전트 고르기…', () => {
    const body = '질문을 보내지 못했습니다. 에이전트 고르기에서 상태를 확인한 뒤 다시 보내세요. 질문은 입력창에 그대로 있습니다.';
    expect(failureCopy({ code: 'AGENT_NOT_READY', phase: 'before', ...claude })).toEqual({ title: `${CLAUDE}가 준비되지 않았습니다`, body, actions: ['choose-agent'], command: null });
    expect(failureCopy({ code: 'AGENT_START_FAILED', phase: 'before', ...claude })).toEqual({ title: `${CLAUDE}가 시작하지 못했습니다`, body, actions: ['choose-agent'], command: null });
  });
  it('during the answer: what came stays, 다시 보내기 asks the same question from the start', () => {
    expect(failureCopy({ code: 'AGENT_EXITED', phase: 'during', ...claude })).toEqual({
      title: `${CLAUDE}가 답하는 도중 멈췄습니다`,
      body: '에이전트 프로그램이 예기치 않게 종료되어 답이 중간에 끊겼습니다. 다시 보내면 에이전트를 다시 시작하고 같은 질문을 처음부터 묻습니다.',
      actions: ['resend'],
      command: null,
    });
    expect(failureCopy({ code: 'AGENT_PROTOCOL', phase: 'during', ...claude })).toEqual(failureCopy({ code: 'AGENT_EXITED', phase: 'during', ...claude }));
    expect(failureCopy({ code: 'AGENT_TIMEOUT', phase: 'during', ...claude })).toEqual({
      title: `${CLAUDE}의 답이 멈췄습니다`,
      body: '한동안 새\u00a0글이 오지 않아 답을 멈췄습니다. 다시 보내면 같은 질문을 처음부터 묻습니다.',
      actions: ['resend'],
      command: null,
    });
  });
  it('during the answer: the lockdown has no 다시 보내기 — the agent must be updated first', () => {
    const v = failureCopy({ code: 'AGENT_LOCKDOWN', phase: 'during', ...claude });
    expect(v).toEqual({
      title: '꺼 둔 도구를 쓰려 해 답을 멈췄습니다',
      body: `${CLAUDE}가 Learn이 꺼 둔 도구를 쓰려 했습니다. 에이전트를 업데이트한 뒤 다시 확인하세요.`,
      actions: ['choose-agent'],
      command: null,
    });
    expect(v.actions).not.toContain('resend');
  });
  it('an answer Learn\'s quit or crash cut off: 다시 보내기, received text or not', () => {
    expect(failureCopy({ code: 'INTERRUPTED', phase: 'during', ...claude })).toEqual({
      title: '답을 받는 도중 Learn이 종료되었습니다',
      body: '다시 보내면 같은 질문을 처음부터 묻습니다.',
      actions: ['resend'],
      command: null,
    });
  });
  it('a resend that could not go or failed before its answer says that code\'s fact, never the composer, and keeps 다시 보내기', () => {
    for (const code of ['OFFLINE', 'AGENT_BUSY', 'AGENT_NOT_READY', 'AGENT_START_FAILED', 'AGENT_LOGIN'] as const) {
      const v = failureCopy({ code, phase: 'during', agent: 'claude', loginCommand: CMD });
      expect(v.actions, code).toContain('resend');
      expect(v.body, code).not.toContain('입력창');
    }
    expect(failureCopy({ code: 'OFFLINE', phase: 'during', ...claude }).title).toBe('인터넷에 연결되어 있지 않습니다');
    expect(failureCopy({ code: 'AGENT_NOT_READY', phase: 'during', ...claude }).actions).toEqual(['choose-agent', 'resend']);
    expect(failureCopy({ code: 'AGENT_LOGIN', phase: 'during', agent: 'claude', loginCommand: CMD })).toMatchObject({ actions: ['copy-login', 'resend'], command: CMD });
  });
  it('another session\'s answer still coming (a 원문 근거 요청 refused for it) says so', () => {
    expect(failureCopy({ code: 'AGENT_BUSY', phase: 'before', ...claude })).toEqual({
      title: '다른\u00a0세션이 답을 받는 중입니다',
      body: '질문을 다시 보내지 못했습니다. 그\u00a0답이 끝난 뒤 다시 보내세요.',
      actions: [],
      command: null,
    });
    expect(failureCopy({ code: 'AGENT_BUSY', phase: 'during', ...claude }).body).toBe('질문을 다시 보내지 못했습니다. 그\u00a0답이 끝난 뒤 다시 보내세요.');
  });
  it('a code with no words of its own reads as the agent stopping, before or during', () => {
    expect(failureCopy({ code: 'INTERNAL', phase: 'before', ...claude }).title).toBe(`${CLAUDE}가 답하기 전에 멈췄습니다`);
    expect(failureCopy({ code: 'INTERNAL', phase: 'during', ...claude })).toEqual({
      title: `${CLAUDE}가 답하는 도중 멈췄습니다`,
      body: '다시 보내면 같은 질문을 처음부터 묻습니다.',
      actions: ['resend'],
      command: null,
    });
  });
  it('joins the agent\'s name with its particle: "Claude Code가", "가짜 에이전트가"', () => {
    expect(failureCopy({ code: 'AGENT_EXITED', phase: 'before', agent: 'fake', loginCommand: null }).title).toBe('가짜 에이전트가 답하기 전에 멈췄습니다');
    expect(failureCopy({ code: 'AGENT_NOT_READY', phase: 'before', agent: 'fake', loginCommand: null }).title).toBe('가짜 에이전트가 준비되지 않았습니다');
    expect(failureCopy({ code: 'AGENT_LOCKDOWN', phase: 'during', agent: 'fake', loginCommand: null }).body).toMatch(/^가짜 에이전트가 Learn이/);
    expect(failureCopy({ code: 'AGENT_TIMEOUT', phase: 'during', agent: 'fake', loginCommand: null }).title).toBe('가짜 에이전트의 답이 멈췄습니다');
  });
  it('a warning for what the user can fix (the network, the login, the agent\'s state), danger for the agent that stopped', () => {
    expect(['OFFLINE', 'AGENT_LOGIN', 'AGENT_NOT_READY', 'AGENT_BUSY'].map((c) => failureTone(c as never))).toEqual(['warning', 'warning', 'warning', 'warning']);
    expect(['AGENT_START_FAILED', 'AGENT_EXITED', 'AGENT_TIMEOUT', 'AGENT_LOCKDOWN', 'INTERRUPTED', 'INTERNAL'].map((c) => failureTone(c as never))).toEqual(['danger', 'danger', 'danger', 'danger', 'danger', 'danger']);
  });
});

describe('원문 근거로 다시 묻기', () => {
  const check = (unverified: CitationCheck['unverified']): CitationCheck => ({ verified: [40], unverified });
  it('only under a finished answer that cited a page inside the document it did not read', () => {
    const inside = check([{ pageIndex: 56, outside: false }, { pageIndex: 998, outside: true }]);
    expect((['complete', 'stopped'] as MessageStatus[]).map((s) => canReground(s, inside))).toEqual([true, true]);
    expect((['failed', 'streaming'] as MessageStatus[]).map((s) => canReground(s, inside))).toEqual([false, false]);
  });
  it('not when the only cites it did not read are past the last page, nor when it read every page it cited', () => {
    expect(canReground('complete', check([{ pageIndex: 998, outside: true }]))).toBe(false);
    expect(canReground('complete', check([]))).toBe(false);
  });
  it('the reground turn\'s bubble names the pages to read first, those past the last page left out', () => {
    expect(regroundBubble(check([{ pageIndex: 56, outside: false }, { pageIndex: 998, outside: true }]))).toBe('57쪽을 먼저 읽고 다시 답해 주세요.');
    expect(regroundBubble(check([{ pageIndex: 56, outside: false }, { pageIndex: 60, outside: false }]))).toBe('57쪽과 61쪽을 먼저 읽고 다시 답해 주세요.');
    expect(regroundBubble(check([{ pageIndex: 1, outside: false }, { pageIndex: 2, outside: false }, { pageIndex: 8, outside: false }]))).toBe('2쪽, 3쪽과 9쪽을 먼저 읽고 다시 답해 주세요.');
    expect(regroundBubble(check([{ pageIndex: 998, outside: true }]))).toBeNull();
  });
});

describe('the page count cites are checked against, and how an answer\'s unverified notice is drawn', () => {
  const answer = (text: string, read: [number, number] | null) => ({
    text,
    tools: read === null ? [] : [{ tool: 'read_pdf_pages', outcome: 'ok' as const, pageFrom: read[0], pageTo: read[1] }],
  });
  it('is the reader\'s once pdf.js has the document; before that the body index\'s when it read every page; else not known (0)', () => {
    expect(knownPageCount(100, { state: 'pending' })).toBe(100);
    expect(knownPageCount(0, { state: 'done', pages: 100, truncated: false })).toBe(100);
    expect(knownPageCount(0, { state: 'empty', pages: 3 })).toBe(3);
    expect(knownPageCount(0, { state: 'done', pages: 5000, truncated: true })).toBe(0);
    expect(knownPageCount(0, { state: 'pending' })).toBe(0);
    expect(knownPageCount(0, { state: 'failed', reason: 'locked' })).toBe(0);
    expect(knownPageCount(0, null)).toBe(0);
  });
  it('checks nothing while the page count is not known: no page can be told inside or past the last one', () => {
    expect(answerCheck(answer('a [[p41]] b [[p43]] c [[p999]]', [40, 41]), 0)).toBeNull();
    expect(answerCheck(answer('a [[p41]] b [[p43]] c [[p999]]', [40, 41]), 100)).toEqual({
      verified: [40],
      unverified: [{ pageIndex: 42, outside: false }, { pageIndex: 998, outside: true }],
    });
  });
  it('a thread drawn before the page count is known shows no notice; once known, the right one', () => {
    const a = answer('a [[p41]] b [[p43]] c [[p999]]', [40, 41]);
    expect(unverifiedForm('complete', answerCheck(a, 0), true)).toBe('none');
    expect(unverifiedForm('complete', answerCheck(a, 100), true)).toBe('full');
  });
  it('only the thread\'s last answer offers 원문 근거로 다시 묻기: an older one keeps the title alone (and so after the turn that asked again)', () => {
    const check = answerCheck(answer('a [[p43]]', [40, 41]), 100);
    expect(unverifiedForm('complete', check, true)).toBe('full');
    expect(unverifiedForm('stopped', check, true)).toBe('full');
    expect(unverifiedForm('complete', check, false)).toBe('title');
  });
  it('the title alone where the button cannot go: only cites past the last page', () => {
    expect(unverifiedForm('complete', answerCheck(answer('a [[p41]] [[p999]]', [40, 41]), 100), true)).toBe('title');
  });
  it('none for a failed answer (its failure stands alone, its 출처 없음 chips mark the pages), one still coming, or one with every cite read', () => {
    const doubted = answerCheck(answer('a [[p43]]', [40, 41]), 100);
    expect(unverifiedForm('failed', doubted, true)).toBe('none');
    expect(unverifiedForm('streaming', doubted, true)).toBe('none');
    expect(unverifiedForm('complete', answerCheck(answer('a [[p41]]', [40, 41]), 100), true)).toBe('none');
  });
});

describe('words that must stay on one line', () => {
  it('↩ keeps its particle (U+2060), and 원문 근거로 is one piece (U+00A0)', () => {
    for (const body of [t.tutor.failure.offlineBody, t.tutor.failure.loginBody, t.tutor.failure.againBody]) expect(body).toContain('↩\u2060로');
    expect(t.tutor.unverified.body).toContain('원문\u00a0근거로');
  });
});
