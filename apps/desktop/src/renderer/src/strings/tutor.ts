// The tutor's copy (spec 13: 합니다체; U+00A0 binds a determiner to its noun, a kind to its count, "Claude Code" and "이 Mac" into one
// piece). T1a has one real agent and one company: the card says Claude Code and Anthropic, as the approved mockup does.
// Rows join this file with the task that draws them; this one holds the mode segment, the consent card and the off state.
import { SPIKE_FACTS, type AgentId } from '@learn/domain';

const AGENT_NAMES: Readonly<Record<AgentId, string>> = { claude: 'Claude Code', fake: '가짜 에이전트' };

/** The "Learn 전용 설정" line: its second sentence only while the spike found the separate login, its third while it found the records. */
export const consentConfigText = (facts: { separateLogin: boolean; historyLine: boolean }): string =>
  [
    '에이전트는 평소 설정과 따로, Learn\u00a0전용\u00a0설정\u00a0폴더를 씁니다.',
    ...(facts.separateLogin ? ['그래서 처음 한 번 따로 로그인해야 합니다.'] : []),
    ...(facts.historyLine ? ['에이전트도 대화 기록을 이 폴더에 남깁니다.'] : []),
  ].join(' ');

export const tutor = {
  /** The reader's right panel: the segment that picks 정보 or 튜터 (the panel's own name is also its toolbar toggle's). */
  mode: { label: '오른쪽 패널', info: '정보', tutor: '튜터' },
  consent: {
    region: '튜터 사용 동의',
    title: '튜터는 이 Mac의 에이전트로 답합니다',
    lead: `튜터는 이 Mac에 설치한 에이전트 프로그램 ${AGENT_NAMES.claude}로 답합니다. 질문은 Anthropic이 처리합니다. 사용량과 요금은 ${AGENT_NAMES.claude}에 로그인한 계정에서 나갑니다.`,
    sends: { title: '보내는 것', text: '지금 질문, 질문에 붙인 구간, 이 세션의 앞선 대화, 자료의 이름과 목차, 지금 보는 쪽, 튜터가 이 자료에서 찾아 읽은 쪽' },
    notSent: { title: '보내지 않는 것', text: '다른 자료와 라이브러리 전체는 보내지 않습니다.' },
    tools: { title: '에이전트의 도구', text: '파일·셸·웹 도구를 끄고, Learn이 허락한 이 자료만 읽게 합니다.' },
    config: { title: 'Learn 전용 설정', text: consentConfigText(SPIKE_FACTS) },
    login: { title: '로그인', text: '로그인 정보는 에이전트 프로그램이 직접 다룹니다. Learn은 이를 보거나 저장하지 않습니다.' },
    note: '질문마다 보낸 범위가 질문 아래에 표시됩니다.',
    later: '나중에',
    agree: '동의',
    agreeTip: '동의 — 카드에 포커스가 있으면 ↩',
  },
  off: {
    title: '튜터가 꺼져 있습니다',
    body: '튜터를 쓰려면 먼저 에이전트에 보내는 범위에 동의해야 합니다. 자료 읽기와 필기는 튜터 없이도 모두 쓸 수 있습니다.',
    turnOn: '튜터 켜기…',
  },
  /** The chooser (spec 8.7, approved mockup state 3): copy as the mockup's data and view code have it, U+00A0 binds included. */
  agents: {
    title: '에이전트 고르기',
    lead: '튜터는 이\u00a0Mac에 설치된 Claude\u00a0Code로 답합니다. 로그인은 Claude\u00a0Code에서 합니다.',
    groupLabel: '에이전트',
    flag: { ready: '준비됨', login: '로그인 필요', missing: '설치 안 됨', old: '지원하지 않는 버전', adapter: '연결 도구 필요' },
    description: {
      ready: '바로 쓸 수 있습니다.',
      adapter: 'Learn과 연결하는 도구를 설치해야 합니다. 터미널에서 아래 명령을 실행한 뒤 다시 확인하세요. 설치할 때 약\u00a0350\u00a0MB를 내려받습니다.',
      login: 'Learn 전용 설정으로 한 번 로그인해야 합니다. 터미널에서 아래 명령을 실행한 뒤 다시 확인하세요.',
      missing: '설치되어 있지 않습니다. 터미널에서 아래 명령으로 설치한 뒤 다시 찾기를 누르세요. 연결 도구는 설치할 때 약\u00a0350\u00a0MB를 내려받습니다.',
      old: (min: { cli: string; adapter: string }) => `Claude\u00a0Code\u00a0${min.cli} 이상과 연결\u00a0도구\u00a0${min.adapter} 이상이 필요합니다. 업데이트한 뒤 다시 확인하세요.`,
      lockdown: '이\u00a0버전은 꺼 둔 도구를 쓰려 했습니다. 업데이트한 뒤 다시 확인하세요.',
      fake: '정해 둔 답과 인용을 돌려줍니다.',
    },
    fakeBadge: '개발용',
    devGroup: '개발·데모 빌드에서만 보입니다',
    recheck: '다시 확인',
    recheckTip: (name: string) => `${name}의 상태를 다시 확인합니다`,
    copy: '명령 복사',
    copied: '복사했습니다',
    research: '다시 찾기',
    researchTip: '설치된 에이전트를 다시 찾습니다',
    searching: '에이전트를 찾는 중…',
    start: '시작',
    startWith: (name: string) => `${name}로 시작`,
    startTip: '↩',
    notReady: 'Claude Code가 준비되지 않았습니다 — 안내를 따른 뒤 다시 확인하세요',
    searchingTip: '에이전트를 찾는 중입니다',
    fakeBand: '가짜 에이전트 · 정해 둔 답을 돌려줍니다(개발·데모 빌드)',
  },
  /** An agent's name as a sentence has it: "Claude Code" is one piece. Anything but a known agent reads as the fake's neutral name. */
  agentName: (id: AgentId): string => AGENT_NAMES[id] ?? AGENT_NAMES.fake,
} as const;
