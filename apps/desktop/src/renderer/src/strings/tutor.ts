// The tutor's copy (spec 13: 합니다체; U+00A0 binds a determiner to its noun, a kind to its count, "Claude Code" and "이 Mac" into one
// piece). T1a has one real agent and one company: the card says Claude Code and Anthropic, as the approved mockup does.
// Rows join this file with the task that draws them: the mode segment, the consent card, the off state, the agent chooser, the
// conversation (Task 17: the empty session, the chips, the sent-scope line and list, the lines under an answer, 최신으로), the
// composer with its agent button and menu (Task 18), the passage attached to a question, what a failed turn, an answer with
// unverified cites and a PDF without readable text say, and the session list.
import { SPIKE_FACTS, type AgentId } from '@learn/domain';
import { eulReul, euroRo, iGa, waGwa } from './josa';

/** A run of pages as the chips write it: "42" or "41–42" (1-based). */
const pages = (from: number, to: number): string => (from === to ? `${from}` : `${from}–${to}`);

const AGENT_NAMES: Readonly<Record<AgentId, string>> = { claude: 'Claude Code', fake: '가짜 에이전트' };

/** An agent's name with 이/가 after it ("Claude Code가", "가짜 에이전트가"). */
const subject = (agent: string): string => `${agent}${iGa(agent)}`;

/** Pages as a list says them: "57쪽", "57쪽과 61쪽", "2쪽, 3쪽과 9쪽" (1-based). */
function pageList(pages: readonly number[]): string {
  const words = pages.map((p) => `${p}쪽`);
  if (words.length < 2) return words[0] ?? '';
  const before = words.slice(0, -1).join(', ');
  return `${before}${waGwa(before)} ${words.at(-1)!}`;
}

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
    startWith: (name: string) => `${name}${euroRo(name)} 시작`,
    startTip: '↩',
    notReady: 'Claude Code가 준비되지 않았습니다 — 안내를 따른 뒤 다시 확인하세요',
    searchingTip: '에이전트를 찾는 중입니다',
    /** Not approved copy: the controller's ruling for a read that got no answer. */
    failedLine: '에이전트를 확인하지 못했습니다. 다시 찾기를 누르세요.',
    failedTip: '에이전트를 확인하지 못했습니다',
    fakeBand: '가짜 에이전트 · 정해 둔 답을 돌려줍니다(개발·데모 빌드)',
  },
  /** The panel head's 새 세션 (spec 8.2): disabled with its reason while the session has no question. */
  newSession: { label: '새\u00a0세션', empty: '지금 세션이 비어 있습니다' },
  /**
   * The new empty session (spec 8.2, 13): its title is the item's, over what the tutor can do with it — with readable body text, or
   * without (the reassurance only where it is true): no text at all, or a text Learn could not read (locked, damaged, given
   * up, too large).
   */
  empty: {
    readable: '이\u00a0자료에 대해 물어보세요. 본문에서 구간을 선택하면 질문에 붙고, 답에는 근거가 된 쪽이 함께 표시됩니다.',
    noText: '이\u00a0자료에 대해 물어보세요. 튜터는 일반\u00a0지식으로 답하고, 답의 쪽은 확인되지 않습니다.',
    unread: '이\u00a0자료에 대해 물어보세요. 본문에서 구간을 선택하면 질문에 붙지만, 답의 쪽은 확인되지 않습니다.',
  },
  /** The line over the session when the PDF's body text cannot be read (spec 8.2, 13; mockup ?state=4&text=…). */
  noText: {
    empty: '이\u00a0PDF에서 글자를 찾지 못해 튜터가 쪽을 읽을 수 없습니다. 스캔한 PDF일 수 있습니다.',
    locked: '암호로 보호된 PDF라 튜터가 본문을 읽을 수 없습니다.',
    failed: '본문을 읽지 못해 튜터가 쪽을 인용할 수 없습니다.',
    large: '파일이 너무 커서 튜터가 본문을 읽을 수 없습니다.',
  },
  /** The conversation column (spec 8.3): its name, 최신으로, and what the hidden status says once at a turn's end. */
  conversation: { label: '대화', latest: '최신으로', received: '답을 받았습니다', stopped: '답을 중지했습니다' },
  /** Citation chips (spec 7, 8.3, 13; the approved "42쪽"). */
  cite: {
    page: (n: number) => `${n}쪽`,
    go: (n: number) => `${n}쪽으로 이동`,
    checking: '확인 중',
    checkingTip: '인용을 확인하는 중입니다',
    none: '출처 없음',
    noneTip: (n: number) => `확인되지 않은 인용 · 튜터가 ${n}쪽을 가리켰지만 이번 답에서 그\u00a0쪽을 읽지 않았습니다`,
    outsideTip: (n: number) => `확인되지 않은 인용 · ${n}쪽은 이\u00a0자료에 없습니다`,
    lostTip: '이\u00a0쪽이 있던 판본을 찾을 수 없습니다',
  },
  /** The tool chips over an answer (spec 8.3, 13): what Learn's tools did in the turn; a status with its tooltip. */
  tools: {
    selection: '선택한 구간 확인',
    selectionTip: '질문에 붙인 구간과 위치를 확인했습니다',
    position: '위치 확인',
    positionTip: '사용자가 보던 쪽과 자료를 확인했습니다',
    outline: '목차 확인',
    outlineTip: '목차를 확인했습니다',
    read: (from: number, to: number) => `${pages(from, to)}쪽 읽음`,
    readTip: (from: number, to: number) => `${pages(from, to)}쪽 본문을 읽었습니다`,
    reading: (from: number, to: number) => `${pages(from, to)}쪽 읽는 중`,
    refused: '범위 밖 요청을 거절함',
    refusedTip: '이\u00a0대화의 범위 밖 자료를 읽으려 해 거절했습니다',
    unread: '쪽을 읽지 못함',
    unreadTip: '본문을 아직 읽을 수 없어 쪽을 돌려주지 못했습니다',
  },
  /** The sent-scope line under a question and its list (spec 8.5): what went out, what the agent was let read, the pages it read. */
  scope: {
    selection: (n: number) => `선택\u00a0${n}`,
    material: '자료\u00a01',
    name: (n: number) => `보낸 것 선택 ${n}개, 읽게 열어 둔 것 자료 1개 — 누르면 목록이 열립니다`,
    sent: '보낸 것',
    open: '읽게 열어 둔 것',
    read: '읽은 쪽',
    agent: '에이전트',
    question: '질문',
    selectionAt: (n: number) => `선택한 구간 · ${n}쪽`,
    replayed: (n: number) => `앞선 대화 ${n}개`,
    reground: '원문 근거 요청',
    pages: (from: number, to: number) => `${pages(from, to)}쪽`,
    none: '없음',
  },
  /** Under an answer (spec 8.3, 13): copying it, and the one line of how it ended. */
  answer: {
    copy: '답 복사',
    copied: '복사했습니다',
    stopped: '중지함',
    cut: '답이 길이 한도에서 끊겼습니다.',
    steps: '에이전트가 한 답에서 할 수 있는 단계를 다 썼습니다.',
    refused: '에이전트가 이\u00a0질문에 답하지 않았습니다.',
    /** After the last line of an answer that failed midway: the part that came, cut off (mockup .tu-cut). */
    cutMark: '\u00a0…',
  },
  /**
   * The composer (spec 8.4, 13; the approved mockup's .tu-composer and its tooltips). A disabled 보내기 says its name and then why,
   * as every control disabled with a reason does ("보내기 — 질문을 입력하면 보낼 수 있습니다").
   */
  composer: {
    placeholder: '질문을 입력하세요',
    receiving: '답을 받는 중입니다',
    opening: '자료를 여는 중입니다',
    send: '보내기',
    sendEmpty: '질문을 입력하면 보낼 수 있습니다',
    sendOpening: '자료를 여는 중입니다',
    sendWaiting: '다른\u00a0세션의 답이 끝나면 보냅니다',
    stop: '중지',
    answering: '답하는 중…',
    /** Above the composer while another session's answer comes (AGENT_BUSY): the question waits in the composer. */
    waiting: '다른\u00a0세션의 답이 끝나면 보냅니다',
    dontSend: '보내지 않기',
  },
  /**
   * The passage attached to the next question (spec 8.4; the approved mockup's chip and its tooltip): its page and words on one
   * line, the tooltip's second line when only part of the selection goes, and the ×.
   */
  attached: {
    chip: (n: number, text: string) => `${n}쪽 · ${text}`,
    tip: (n: number) => `질문에 붙은 구간 · ${n}쪽 — 질문과 함께 보냅니다`,
    multipage: '여러 쪽에 걸친 선택은 첫 쪽의 글만 붙습니다.',
    long: '앞 4,000자만 보냅니다.',
    remove: '구간 떼기',
  },
  /**
   * The composer's agent button and its menu (spec 8.4, 8.7; the approved mockup: the button's tooltip, the disabled row's reason by
   * state, the fake row's tooltip). The agent's name is one piece wherever a tooltip may wrap.
   */
  agentMenu: {
    /** After the name, a piece of its own ("Claude Code" + " · 로그인 필요"): it may step aside whole while the name stays. */
    stateAfterName: (state: string) => `\u00a0· ${state}`,
    tip: (name: string, state: string) => `에이전트: ${String(name).replace(/ /g, '\u00a0')} · ${state} — 누르면 에이전트를 바꿉니다`,
    fakeTip: '가짜 에이전트 · 개발·데모 빌드에서만 보입니다',
    disabled: (name: string, state: string) => `${name} — ${state}`,
    why: {
      adapter: 'Learn과 연결하는 도구를 설치한 뒤 에이전트 고르기에서 다시 확인하세요',
      login: 'Learn 전용 설정으로 로그인한 뒤 에이전트 고르기에서 다시 확인하세요',
      old: '업데이트한 뒤 에이전트 고르기에서 다시 확인하세요',
      missing: '설치한 뒤 에이전트 고르기에서 다시 찾으세요',
    },
    fakeRowTip: '개발·데모 빌드에서만 보입니다',
  },
  /**
   * What a failed turn says (spec 8.8, 13; the approved mockup ?state=8&fail=…): before any answer the question is back in the composer;
   * during one the part that came stays, with 다시 보내기. A resend that could not go, or whose turn failed before its answer, says its
   * code's fact over the failed answer and keeps 다시 보내기.
   */
  failure: {
    offline: '인터넷에 연결되어 있지 않습니다',
    offlineBody: '질문을 보내지 못했습니다. 연결을 확인한 뒤 입력창에서 ↩\u2060로 보내세요. 질문은 입력창에 그대로 있습니다.',
    login: (agent: string) => `${agent} 로그인이 필요합니다`,
    loginBody: '질문을 보내지 못했습니다. 터미널에서 아래 명령으로 로그인한 뒤 입력창에서 ↩\u2060로 보내세요. 질문은 입력창에 그대로 있습니다.',
    notReady: (agent: string) => `${subject(agent)} 준비되지 않았습니다`,
    startFailed: (agent: string) => `${subject(agent)} 시작하지 못했습니다`,
    chooseBody: '질문을 보내지 못했습니다. 에이전트 고르기에서 상태를 확인한 뒤 다시 보내세요. 질문은 입력창에 그대로 있습니다.',
    timeout: (agent: string) => `${subject(agent)} 답하지 않습니다`,
    stoppedBefore: (agent: string) => `${subject(agent)} 답하기 전에 멈췄습니다`,
    againBody: '답을 받지 못했습니다. 잠시 뒤 입력창에서 ↩\u2060로 다시 보내세요. 질문은 입력창에 그대로 있습니다.',
    stoppedDuring: (agent: string) => `${subject(agent)} 답하는 도중 멈췄습니다`,
    stoppedDuringBody: '에이전트 프로그램이 예기치 않게 종료되어 답이 중간에 끊겼습니다. 다시 보내면 에이전트를 다시 시작하고 같은 질문을 처음부터 묻습니다.',
    timeoutDuring: (agent: string) => `${agent}의 답이 멈췄습니다`,
    timeoutDuringBody: '한동안 새\u00a0글이 오지 않아 답을 멈췄습니다. 다시 보내면 같은 질문을 처음부터 묻습니다.',
    lockdown: '꺼 둔 도구를 쓰려 해 답을 멈췄습니다',
    lockdownBody: (agent: string) => `${subject(agent)} Learn이 꺼 둔 도구를 쓰려 했습니다. 에이전트를 업데이트한 뒤 다시 확인하세요.`,
    interrupted: '답을 받는 도중 Learn이 종료되었습니다',
    resendBody: '다시 보내면 같은 질문을 처음부터 묻습니다.',
    busy: '다른\u00a0세션이 답을 받는 중입니다',
    notResent: {
      offline: '질문을 다시 보내지 못했습니다. 연결을 확인한 뒤 다시 보내세요.',
      login: '질문을 다시 보내지 못했습니다. 터미널에서 아래 명령으로 로그인한 뒤 다시 보내세요.',
      choose: '질문을 다시 보내지 못했습니다. 에이전트 고르기에서 상태를 확인한 뒤 다시 보내세요.',
      busy: '질문을 다시 보내지 못했습니다. 그\u00a0답이 끝난 뒤 다시 보내세요.',
    },
    resend: '다시 보내기',
    resendTip: '같은 질문을 처음부터 다시 묻습니다',
    /** A session whose thread could not be read: its notice in the column, with 다시 시도 (the app's retry). */
    thread: '세션을 열지 못했습니다',
  },
  /** Under an answer that cited pages it did not read in its turn (spec 7, 8.3, 13; mockup ?state=6), and the reground turn's bubble. */
  unverified: {
    title: (n: number) => `인용 ${n}개를 확인하지 못했습니다`,
    body: '튜터가 이번 답에서 읽지 않은 쪽을 가리켰습니다. 원문\u00a0근거로 다시 물으면 튜터가 먼저 그\u00a0쪽을 읽고 답하게 합니다. 이번에도 읽지 않은 쪽을 가리키면 다시 표시합니다.',
    reground: '원문 근거로 다시 묻기',
    /** "57쪽을 먼저 읽고 다시 답해 주세요." — the pages 1-based, in the order the answer cited them. */
    ask: (first: number, ...more: number[]) => {
      const list = pageList([first, ...more]);
      return `${list}${eulReul(list)} 먼저 읽고 다시 답해 주세요.`;
    },
  },
  /**
   * The session list (spec 8.9, 13; the approved mockup's reader segment, its empty state, the library's section): a row's tooltip
   * is its name and when it was last talked in, and says so of a fake agent's session.
   */
  sessions: {
    segment: '세션',
    tree: '세션',
    libraryHeading: '세션',
    emptyTitle: '이\u00a0자료의 세션이 없습니다',
    emptyText: '튜터에게 질문하면 여기에 생깁니다.',
    /** When it was last talked in, and the fake agent's mark: a row's description, and its tooltip after the name — one piece, so a long name wraps before it. */
    when: (time: string, fake: boolean) => `${time}${fake ? ' · 가짜 에이전트' : ''}`.replace(/ /g, '\u00a0'),
    /** The row's tooltip: the name, then `when` (the dot stays with the name when it wraps). */
    tip: (name: string, when: string) => `${name}\u00a0· ${when}`,
    /** The pane's read that failed: its title (the library list's own words, for this list). */
    listFailed: '세션 목록을 불러오지 못했습니다',
    nameLabel: '세션 이름',
    nameTooLong: '세션 이름은 200자까지 쓸 수 있습니다.',
    deleted: '세션을 삭제했습니다',
    deleteFailed: '세션을 삭제하지 못했습니다',
    renameFailed: '세션 이름을 바꾸지 못했습니다',
  },
  /** The copied answer's cites (citationCopyText): "(42쪽)", "(출처 없음)". */
  copy: { page: (n: number) => `(${n}쪽)`, none: '(출처 없음)' },
  /** An agent's name as a sentence has it: "Claude Code" is one piece. Anything but a known agent reads as the fake's neutral name. */
  agentName: (id: AgentId): string => AGENT_NAMES[id] ?? AGENT_NAMES.fake,
} as const;
