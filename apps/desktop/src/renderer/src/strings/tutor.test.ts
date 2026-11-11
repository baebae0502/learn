import { describe, expect, it } from 'vitest';
import { SPIKE_FACTS } from '@learn/domain';
import { consentConfigText, tutor } from './tutor';

describe('the tutor copy (approved mockup, 2026-11-12)', () => {
  it('names one agent and one company, and no other', () => {
    const card = JSON.stringify(tutor.consent);
    expect(card).toContain('Claude Code');
    expect(card).toContain('Anthropic');
    expect(card).not.toMatch(/OpenAI|Codex/);
    expect(tutor.agentName('claude')).toBe('Claude Code');
  });
  it('keeps the Learn-only line to what the spike found: the second sentence for the separate login, the third for the records', () => {
    expect(SPIKE_FACTS).toEqual({ separateLogin: true, historyLine: true });
    const all = consentConfigText({ separateLogin: true, historyLine: true });
    expect(all.split('. ').length).toBe(3);
    expect(all).toContain('따로 로그인해야 합니다');
    expect(all).toContain('대화 기록을');
    expect(tutor.consent.config.text).toBe(all);
    const noLogin = consentConfigText({ separateLogin: false, historyLine: true });
    expect(noLogin).not.toContain('로그인');
    expect(noLogin).toContain('대화 기록을');
    const noHistory = consentConfigText({ separateLogin: true, historyLine: false });
    expect(noHistory).toContain('로그인');
    expect(noHistory).not.toContain('기록');
    expect(consentConfigText({ separateLogin: false, historyLine: false })).toBe('에이전트는 평소 설정과 따로, Learn\u00a0전용\u00a0설정\u00a0폴더를 씁니다.'); // the term stays whole at a narrow panel
  });
  it('binds "이 Mac" and "다른 자료" with U+00A0, and never says an internal word', () => {
    expect(tutor.consent.title).toContain('이 Mac');
    expect(tutor.consent.lead).toContain('이 Mac');
    expect(tutor.consent.notSent.text).toContain('다른 자료');
    expect(JSON.stringify(tutor)).not.toMatch(/ACP|MCP|어댑터|백엔드|토큰|프로세스/);
  });
});
