import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '@learn/domain';
import { agentRow, commandParts } from './agentRows';

const base: AgentStatus = { id: 'claude', name: 'Claude Code', state: 'ready', cliVersion: '2.1.318', adapterVersion: '0.103.0', minimum: { cli: '2.1.318', adapter: '0.103.0' }, command: null, note: null };
const row = (over: Partial<AgentStatus>) => agentRow({ ...base, ...over });

describe('agentRow: the five states of the Claude Code row (approved copy)', () => {
  it('ready: selectable, nothing to run', () => {
    expect(row({})).toMatchObject({ name: 'Claude\u00a0Code', flag: '준비됨', description: '바로 쓸 수 있습니다.', action: null, recheck: false, command: null, selectable: true });
  });
  it('adapter: the connection tool\'s install command and a recheck, with the download size bound', () => {
    const cmd = 'npm install -g @agentclientprotocol/claude-agent-acp@0.103.0';
    const r = row({ state: 'adapter', command: cmd });
    expect(r).toMatchObject({ flag: '연결 도구 필요', action: 'copy-install', recheck: true, command: cmd, selectable: false });
    expect(r.description.endsWith('설치할 때 약 350 MB를 내려받습니다.')).toBe(true);
  });
  it('login: the Learn-only login command and a recheck', () => {
    expect(row({ state: 'login', command: 'x claude auth login' })).toMatchObject({
      flag: '로그인 필요', action: 'copy-login', recheck: true, selectable: false,
      description: 'Learn 전용 설정으로 한 번 로그인해야 합니다. 터미널에서 아래 명령을 실행한 뒤 다시 확인하세요.',
    });
  });
  it('old: the minimum versions from the catalog, with the approved binds; a recheck, no command', () => {
    const r = row({ state: 'old', cliVersion: '2.1.300', minimum: { cli: '2.1.318', adapter: '0.103.0' } });
    expect(r).toMatchObject({ flag: '지원하지 않는 버전', action: 'recheck', recheck: true, command: null, selectable: false });
    expect(r.description).toBe('Claude Code 2.1.318 이상과 연결 도구 0.103.0 이상이 필요합니다. 업데이트한 뒤 다시 확인하세요.');
    expect(r.description.replace(/ /g, ' ')).toBe('Claude Code 2.1.318 이상과 연결 도구 0.103.0 이상이 필요합니다. 업데이트한 뒤 다시 확인하세요.');
  });
  it('old by the lockdown watch, or with no minimum: the lockdown sentence', () => {
    const lock = '이 버전은 꺼 둔 도구를 쓰려 했습니다. 업데이트한 뒤 다시 확인하세요.';
    expect(row({ state: 'old', note: 'lockdown' }).description).toBe(lock);
    expect(row({ state: 'old', minimum: null }).description).toBe(lock);
  });
  it('missing: the install of both packages, copied as shown; no recheck (다시 찾기 finds it)', () => {
    const cmd = 'npm install -g @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp@0.103.0';
    const r = row({ state: 'missing', command: cmd, cliVersion: null, adapterVersion: null });
    expect(r).toMatchObject({ flag: '설치 안 됨', action: 'copy-install', recheck: false, command: cmd, selectable: false });
    expect(r.description).toBe('설치되어 있지 않습니다. 터미널에서 아래 명령으로 설치한 뒤 다시 찾기를 누르세요. 연결 도구는 설치할 때 약 350 MB를 내려받습니다.');
  });
  it('the fake agent: named so, with its badge and description, selectable when ready, never a command', () => {
    expect(agentRow({ ...base, id: 'fake', name: 'x', command: null, minimum: null })).toMatchObject({
      name: '가짜 에이전트', flag: '개발용', description: '정해 둔 답과 인용을 돌려줍니다.', action: null, recheck: false, command: null, selectable: true,
    });
  });
});

describe('commandParts: breaks after a space and after "/", nowhere else', () => {
  it('splits an npm command at its words and the package scope', () => {
    expect(commandParts('npm install -g @agentclientprotocol/claude-agent-acp@0.103.0')).toEqual(['npm ', 'install ', '-g ', '@agentclientprotocol/', 'claude-agent-acp@0.103.0']);
  });
  it('keeps a space inside double quotes whole, as U+00A0', () => {
    expect(commandParts('CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Learn/Tutor/agents/claude" claude auth login')).toEqual([
      'CLAUDE_CONFIG_DIR=', '"$HOME/', 'Library/', 'Application Support/', 'Learn/', 'Tutor/', 'agents/', 'claude" ', 'claude ', 'auth ', 'login',
    ]);
  });
  it('breaks after the "=" of a leading assignment only', () => {
    expect(commandParts('A_B=x/y c=d')).toEqual(['A_B=', 'x/', 'y ', 'c=d']);
    expect(commandParts('npm --prefix=/opt/x')).toEqual(['npm ', '--prefix=/', 'opt/', 'x']);
  });
  it('joins back to the command (with the quoted spaces bound)', () => {
    const c = 'a "b c" d/e f';
    expect(commandParts(c).join('').replace(/ /g, ' ')).toBe(c);
  });
});
