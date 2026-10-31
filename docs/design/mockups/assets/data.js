/*
 * Mockup content. Every person, publisher and title here is fictional; no real people or
 * organisations are depicted. Numbers are internally consistent across screens
 * (e.g. the open PDF is page 42 of 68 = 62 %, the open lecture is 18:20 of 52:10 = 35 %).
 */
window.MockupData = (() => {
  const tags = {
    important: { name: '중요', color: 1 },
    exam: { name: '시험 범위', color: 2 },
    review: { name: '다시 보기', color: 4 },
    question: { name: '질문 있음', color: 5 },
  };
  const plainTags = [
    '수용체', 'G 단백질', '2차 전령', '인산화', '세포 주기', '막 단백질', '강의', '논문', '실험', '영어',
  ];
  const dimTags = ['회귀분석', '표본 추출', '실험 설계'];

  const collections = [
    { id: 'molbio', name: '분자생물학', count: 48, open: true, children: [
      { id: 'ch6', name: '6장 · 신호 전달', count: 14 },
      { id: 'ch7', name: '7장 · 세포 주기', count: 9 },
      { id: 'lab', name: '실험 노트', count: 6 },
    ] },
    { id: 'stats', name: '통계', count: 31, children: [{ id: 'reg', name: '회귀분석', count: 12 }] },
    { id: 'methods', name: '연구 방법', count: 22 },
    { id: 'journal', name: '논문 읽기 모임', count: 15 },
    { id: 'english', name: '영어 원서', count: 7 },
    { id: 'conf', name: '학회 준비', count: 0 },
  ];

  // kind: pdf | video. progress: 0–100 or null (never opened). flags: linked, missing.
  const items = [
    { id: 1, kind: 'pdf', title: '분자생물학 6장 · 신호 전달', authors: '한서진 외', year: 2024, progress: 62, added: '어제 오후 8:40', tags: [1, 2] },
    { id: 2, kind: 'video', title: '강의 04 · 세포 신호', authors: '윤재하', year: 2025, progress: 35, added: '어제 오후 8:38', tags: [2] },
    { id: 3, kind: 'pdf', title: 'G Protein–Coupled Receptor Dynamics in Live Cells', authors: 'Okafor, Lindqvist', year: 2023, progress: 18, added: '어제 오후 4:41', tags: [4] },
    { id: 4, kind: 'pdf', title: '신호 증폭의 정량 모델', authors: '배유나', year: 2022, progress: null, added: '어제 오후 4:40', tags: [] },
    { id: 5, kind: 'video', title: '강의 05 · 2차 전령', authors: '윤재하', year: 2025, progress: null, added: '2026. 10. 17.', tags: [] },
    { id: 6, kind: 'pdf', title: 'Kinase Cascades: A Primer', authors: 'Marlowe', year: 2021, progress: 100, added: '2026. 10. 16.', tags: [] },
    { id: 7, kind: 'video', title: '수용체 탈감작 세미나 녹화', authors: '정민호', year: 2026, progress: null, added: '2026. 10. 15.', tags: [5], linked: true, unplayable: true },
    { id: 8, kind: 'pdf', title: 'Calcium Signaling Revisited', authors: 'Ishikawa, Petrov', year: 2024, progress: null, added: '2026. 10. 14.', tags: [], linked: true, missing: true },
    { id: 9, kind: 'pdf', title: '분자생물학 7장 · 세포 주기', authors: '한서진 외', year: 2024, progress: 8, added: '2026. 10. 12.', tags: [] },
    { id: 10, kind: 'video', title: '강의 06 · 세포 주기 조절', authors: '윤재하', year: 2025, progress: null, added: '2026. 10. 12.', tags: [] },
    { id: 11, kind: 'pdf', title: '실험 3 · 웨스턴 블롯 프로토콜', authors: '연구실 공용', year: 2026, progress: 100, added: '2026. 10. 10.', tags: [] },
    { id: 12, kind: 'pdf', title: 'Phosphorylation Switches in Signal Relay', authors: 'Abernathy, Sato', year: 2020, progress: 45, added: '2026. 10. 9.', tags: [4] },
    { id: 13, kind: 'pdf', title: '세포막 수용체 정리', authors: '—', year: 2026, progress: 100, added: '2026. 10. 8.', tags: [1] },
    { id: 14, kind: 'video', title: '강의 03 · 막 단백질', authors: '윤재하', year: 2025, progress: 100, added: '2026. 10. 6.', tags: [] },
    { id: 15, kind: 'pdf', title: 'Second Messengers at a Glance', authors: 'Varga, Ndlovu', year: 2022, progress: 30, added: '2026. 10. 5.', tags: [] },
    { id: 16, kind: 'pdf', title: '중간고사 대비 문제 풀이', authors: '김하린', year: 2026, progress: null, added: '2026. 10. 4.', tags: [2] },
    { id: 17, kind: 'pdf', title: '세포 신호 그림 모음', authors: '한서진', year: 2024, progress: 5, added: '2026. 10. 3.', tags: [] },
    { id: 18, kind: 'video', title: '강의 02 · 세포 소기관', authors: '윤재하', year: 2025, progress: 100, added: '2026. 9. 29.', tags: [] },
    { id: 19, kind: 'pdf', title: 'Receptor Tyrosine Kinases: Structure and Function', authors: 'Brennan, Osei', year: 2019, progress: null, added: '2026. 9. 28.', tags: [5] },
    { id: 20, kind: 'pdf', title: '분자생물학 5장 · 막 수송', authors: '한서진 외', year: 2024, progress: 100, added: '2026. 9. 26.', tags: [] },
    { id: 21, kind: 'video', title: '강의 01 · 오리엔테이션', authors: '윤재하', year: 2025, progress: 100, added: '2026. 9. 22.', tags: [] },
    { id: 22, kind: 'pdf', title: '효소 반응 속도론 요약', authors: '배유나', year: 2021, progress: 70, added: '2026. 9. 20.', tags: [] },
    { id: 23, kind: 'pdf', title: 'Ion Channels in Excitable Membranes', authors: 'Lindqvist', year: 2018, progress: null, added: '2026. 9. 18.', tags: [] },
    { id: 24, kind: 'pdf', title: '실험 2 · 단백질 정량', authors: '연구실 공용', year: 2026, progress: 100, added: '2026. 9. 15.', tags: [] },
    { id: 25, kind: 'pdf', title: '분자생물학 4장 · 단백질 구조', authors: '한서진 외', year: 2024, progress: 100, added: '2026. 9. 12.', tags: [] },
    { id: 26, kind: 'video', title: '실습 영상 · 피펫 사용법', authors: '연구실 공용', year: 2026, progress: 100, added: '2026. 9. 10.', tags: [] },
    { id: 27, kind: 'pdf', title: 'Signal Transduction Problem Set', authors: 'Okafor', year: 2023, progress: null, added: '2026. 9. 8.', tags: [] },
    { id: 28, kind: 'pdf', title: '막 수용체 결합 실험 데이터', authors: '연구실 공용', year: 2026, progress: null, added: '2026. 9. 6.', tags: [] },
    { id: 29, kind: 'video', title: '강의 07 · 세포 사멸', authors: '윤재하', year: 2025, progress: null, added: '2026. 9. 5.', tags: [] },
    { id: 30, kind: 'pdf', title: 'Allosteric Regulation Revisited', authors: 'Sato', year: 2017, progress: 22, added: '2026. 9. 3.', tags: [] },
    { id: 31, kind: 'pdf', title: '분자생물학 3장 · 효소', authors: '한서진 외', year: 2024, progress: 100, added: '2026. 9. 2.', tags: [] },
    { id: 32, kind: 'video', title: '세미나 · 단일 세포 이미징', authors: '정민호', year: 2026, progress: 40, added: '2026. 8. 29.', tags: [4], linked: true },
    { id: 33, kind: 'pdf', title: '기말 요약 노트 (작년)', authors: '김하린', year: 2025, progress: null, added: '2026. 8. 28.', tags: [] },
    { id: 34, kind: 'pdf', title: 'Cell Signaling Glossary', authors: 'Varga', year: 2020, progress: 100, added: '2026. 8. 27.', tags: [] },
  ];

  const selectedItem = {
    kind: 'PDF 문서',
    title: '분자생물학 6장 · 신호 전달',
    authors: '한서진, 윤재하, 배유나',
    info: [
      ['저자', '한서진, 윤재하, 배유나'],
      ['연도', '2024'],
      ['판', '3판'],
      ['쪽수', '68쪽'],
      ['언어', '한국어'],
      ['추가일', '2026. 10. 20. 오후 8:40'],
      ['수정일', '2026. 10. 21. 오전 9:30'],
    ],
    reading: { page: 42, pages: 68, percent: 62, opened: '오늘 오전 9:24' },
    file: [
      ['보관', '복사본 · 라이브러리 안'],
      ['크기', '4.2 MB'],
      ['원래 이름', 'molbio_ch06_signaling.pdf'],
    ],
    sha: '9c417a2e…',
    shaFull: '9c417a2e5d0b7f13c8e4a96d2b1f07e3a5c86d49f0e2b7a13c5d8e6f051d8e07b',
    tags: [1, 2],
    plainTags: ['수용체', 'G 단백질', '2차 전령'],
    collections: [['분자생물학'], ['분자생물학', '6장 · 신호 전달']],
  };

  const outline = [
    { t: '6.1 세포 신호의 종류', p: 2, lvl: 0 },
    { t: '6.2 수용체의 구조', p: 14, lvl: 0 },
    { t: '6.3 G 단백질 연결 수용체', p: 27, lvl: 0 },
    { t: '6.4 신호 증폭', p: 41, lvl: 0, open: true },
    { t: '연쇄 반응과 증폭 배율', p: 42, lvl: 1, current: true },
    { t: '2차 전령의 역할', p: 44, lvl: 1 },
    { t: '신호의 종료', p: 46, lvl: 1 },
    { t: '6.5 수용체 타이로신 인산화효소', p: 49, lvl: 0 },
    { t: '6.6 신호 통합과 교차 대화', p: 57, lvl: 0 },
    { t: '6장 정리', p: 64, lvl: 0 },
    { t: '연습 문제', p: 66, lvl: 0 },
  ];

  // Transcript cues for 강의 04 · 세포 신호 (current position 18:20).
  const cues = [
    ['17:02', '자, 그러면 수용체가 활성화된 다음에 무슨 일이 일어나는지 볼게요.'],
    ['17:09', '활성화된 수용체는 세포막 안쪽에 있는 G\u00a0단백질과 만납니다.'],
    ['17:18', 'G\u00a0단백질은 GDP를 내놓고 GTP와 결합하면서 켜진 상태가 돼요.'],
    ['17:31', '여기서 중요한 건, 수용체 하나가 G\u00a0단백질을 한 개만 켜는 게 아니라는 점입니다.'],
    ['17:44', '수용체가 붙어 있는 동안 계속해서 여러 개를 차례로 활성화합니다.'],
    ['18:02', '그다음 단계인 아데닐산 고리화효소도 마찬가지예요.'],
    ['18:14', '효소 하나가 cAMP를 수백, 수천 개씩 만들어 냅니다.'],
    ['18:20', '그래서 이 단계에서 신호가 수백 배로 증폭됩니다.', 'current'],
    ['18:29', '교과서 42쪽 그림 6-4를 같이 보시면 단계마다 화살표가 굵어지죠.'],
    ['18:41', '이게 바로 증폭 배율이 곱해진다는 뜻입니다.'],
    ['18:52', '반대로 신호를 끄는 쪽도 생각해 봐야 하는데요,'],
    ['19:03', 'GTP가 GDP로 가수분해되면 G\u00a0단백질은 다시 꺼집니다.'],
    ['19:15', '그리고 포스포다이에스터레이스가 cAMP를 분해하죠.'],
    ['19:28', '켜는 속도와 끄는 속도의 균형이 반응의 크기를 정합니다.'],
    ['19:40', '다음 시간에는 2차 전령을 하나씩 자세히 보겠습니다.'],
  ];

  const memos = [
    { at: 0.16, color: 1 },
    { at: 0.33, color: 2 },
    { at: 0.352, color: 4 },
    { at: 0.61, color: 1 },
  ];

  // Tutor (T1 mockup, tutor.html). The open PDF is 분자생물학 6장 at p. 42 (opened 오늘 오전 9:24);
  // the session started at 9:31. Pages and quotes are the PDF's own text (views.js pageBody 41–42).
  // A session is named after its first question (T1); the user can rename it.
  const tutor = {
    item: '분자생물학 6장 · 신호 전달',
    session: '‘각 단계 배율의 곱’이 무슨 뜻인지 예를 들어 설명해 주세요',
    started: '오늘 오전 9:31',
    selection: { page: 42, text: '전체 증폭 배율은 각 단계 배율의 곱으로 근사할 수 있다.' },
    // Sessions of the open item, newest first, grouped by day. Rows show no time (the day group says the
    // day); `at` is the row's tooltip.
    itemSessions: [
      { group: '오늘', rows: [
        { title: '‘각 단계 배율의 곱’이 무슨 뜻인지 예를 들어 설명해 주세요', at: '오전 9:31', current: true },
        { title: 'cAMP와 칼슘 이온은 어떻게 다른가요?', at: '오전 8:50', rename: true },
      ] },
      { group: '어제', rows: [{ title: '6.3절을 다섯 줄로 요약해 주세요', at: '오후 9:12' }] },
      { group: '지난 7일', rows: [
        { title: '연습 문제 3번 풀이가 맞는지 봐 주세요', at: '10월 22일' },
        { title: '그림 6-2는 어떻게 읽나요?', at: '10월 21일' },
      ] },
    ],
    // Library-wide sessions, grouped by item, item groups ordered by their latest session (no times: the
    // order is the information; the date is in the tooltip). Up to 5 items × 3 sessions.
    recentSessions: [
      { item: '분자생물학 6장 · 신호 전달', kind: 'pdf', rows: [
        { title: '‘각 단계 배율의 곱’이 무슨 뜻인지 예를 들어 설명해 주세요', at: '오늘 오전 9:31' },
        { title: 'cAMP와 칼슘 이온은 어떻게 다른가요?', at: '오늘 오전 8:50' },
      ] },
      { item: 'G Protein–Coupled Receptor Dynamics in Live Cells', kind: 'pdf', rows: [{ title: '초록을 한국어로 정리해 주세요', at: '어제 오후 4:52' }] },
    ],
    // Detected agents (ADR-0010 §1). Program names are the programs' own; our feature is only "튜터".
    // Codex and Claude Code reach Learn through a separate ACP adapter (`cmd`); Gemini CLI and opencode have it built in.
    agents: [
      { id: 'codex', name: 'Codex', status: 'ready', text: '이&nbsp;프로그램에 설정한 계정으로 답합니다.' },
      { id: 'claude', name: 'Claude Code', status: 'adapter', text: 'Claude Code는 있지만 Learn과 연결하는 도구가 없습니다. 터미널에서 아래 명령으로 설치한 뒤 다시 확인하세요(Node 22 이상).', cmd: 'npm i -g @agentclientprotocol/claude-agent-acp' },
      { id: 'gemini', name: 'Gemini CLI', status: 'login', text: '터미널에서 <span class="mono">gemini</span>를 실행하고 안내에 따라 로그인한 뒤 다시 확인하세요.' },
      { id: 'opencode', name: 'opencode', status: 'old', text: '설치된 버전은 Learn과 연결할 수 없습니다. 최신&nbsp;버전으로 업데이트한 뒤 다시 확인하세요.' },
    ],
  };

  // M6 (docs/superpowers/specs/2026-10-31-m6-p1-gate-design.md §13). The trash holds 2 collection rows and 7
  // items (sidebar count 9, spec 4.3); the first three went together, so they share one deleted time.
  const trash = {
    // `count`: the items still in the library (a trashed collection's items stay there, spec 4.2).
    collections: [
      { name: '지난 학기 통계 스터디', count: 6, deleted: '2026. 10. 12.' },
      { name: '임시 모음', count: 3, deleted: '2026. 10. 3.' },
    ],
    items: [
      { id: 101, kind: 'pdf', title: '세포 호흡 요약 (작년 판)', authors: '김하린', year: 2025, progress: null, added: '2026. 9. 1.', deleted: '오늘 오전 9:12', tags: [] },
      { id: 102, kind: 'video', title: '강의 03 · 막 단백질 (재업로드)', authors: '윤재하', year: 2025, progress: null, added: '2026. 10. 7.', deleted: '오늘 오전 9:12', tags: [] },
      { id: 103, kind: 'pdf', title: 'Signal Transduction Problem Set (draft)', authors: 'Okafor', year: 2023, progress: 12, added: '2026. 9. 8.', deleted: '오늘 오전 9:12', tags: [] },
      { id: 104, kind: 'pdf', title: '중간고사 대비 문제 풀이 (초안)', authors: '김하린', year: 2026, progress: 20, added: '2026. 10. 2.', deleted: '어제 오후 6:05', tags: [2] },
      { id: 105, kind: 'pdf', title: '실험 1 · 시약 준비', authors: '연구실 공용', year: 2026, progress: 100, added: '2026. 9. 14.', deleted: '2026. 10. 18.', tags: [] },
      { id: 106, kind: 'pdf', title: '통계 과제 2 풀이', authors: '배유나', year: 2026, progress: null, added: '2026. 9. 30.', deleted: '2026. 10. 15.', tags: [] },
      { id: 107, kind: 'pdf', title: '학회 포스터 초안', authors: '정민호', year: 2026, progress: null, added: '2026. 9. 20.', deleted: '2026. 10. 9.', tags: [] },
    ],
    // The selected trashed item's panel (read-only).
    selected: {
      kind: 'PDF 문서',
      pages: 24,
      title: '세포 호흡 요약 (작년 판)',
      authors: '김하린',
      year: 2025,
      deleted: '오늘 오전 9:12',
      info: [
        ['저자', '김하린'],
        ['연도', '2025'],
        ['쪽수', '24쪽'],
        ['언어', '한국어'],
        ['추가일', '2026. 9. 1. 오후 3:20'],
        ['수정일', '2026. 9. 1. 오후 3:20'],
      ],
      file: [
        ['보관', '복사본 · 라이브러리 안'],
        ['크기', '1.8 MB'],
        ['원래 이름', 'cell-respiration-2025.pdf'],
      ],
      sha: '4be1c09d…',
      shaFull: '4be1c09d73a2f5e86b0d14c9a7e3f2b58d61c0a94e7f3b2d5c8a1e6f09b4d7c2',
      plainTags: ['기말'],
      collections: [['분자생물학']],
    },
  };

  // 중복 항목 (M5): two groups of the same file — 2 + 3 items (sidebar count 5). The view keeps a group's rows together
  // whatever the sort (here 추가일, newest first, inside and between groups); `kept` = the earliest import, which stays.
  const duplicates = [
    { id: 203, kind: 'pdf', title: '분자생물학 6장 · 신호 전달', authors: '한서진 외', year: 2024, progress: null, added: '오늘 오전 9:02', tags: [] },
    { id: 1, kind: 'pdf', title: '분자생물학 6장 · 신호 전달', authors: '한서진 외', year: 2024, progress: 62, added: '어제 오후 8:40', tags: [1, 2], kept: true },
    { id: 202, kind: 'pdf', title: 'Kinase Cascades: A Primer', authors: 'Marlowe', year: 2021, progress: null, added: '어제 오후 4:12', tags: [4], groupStart: true },
    { id: 201, kind: 'pdf', title: 'Kinase Cascades: A Primer', authors: 'Marlowe', year: 2021, progress: null, added: '2026. 10. 19.', tags: [] },
    { id: 6, kind: 'pdf', title: 'Kinase Cascades: A Primer', authors: 'Marlowe', year: 2021, progress: 100, added: '2026. 10. 16.', tags: [], kept: true },
  ];

  // An item with one copy that another app changed (spec 6): `<제목> (수정본 YYYY-MM-DD HHmm).<확장자>`.
  const edited = {
    row: { id: 301, kind: 'pdf', title: '세포생물학 3장', authors: '배유나', year: 2023, progress: 64, added: '2026. 10. 13.', tags: [4] },
    selected: {
      kind: 'PDF 문서',
      pages: 52,
      title: '세포생물학 3장',
      authors: '배유나',
      year: 2023,
      reading: { page: 33, pages: 52, percent: 64, opened: '어제 오후 2:05' },
      info: [
        ['저자', '배유나'],
        ['연도', '2023'],
        ['쪽수', '52쪽'],
        ['언어', '한국어'],
        ['추가일', '2026. 10. 13. 오전 10:48'],
        ['수정일', '2026. 10. 13. 오전 10:48'],
      ],
      file: [
        ['보관', '복사본 · 라이브러리 안'],
        ['크기', '6.3 MB'],
        ['원래 이름', 'cellbio_ch03.pdf'],
      ],
      tags: [4],
      sha: 'd07a5e31…',
      shaFull: 'd07a5e3194c2b8f60e1a7d53c9b4f2e8a6d01c7395e4b2f8a0c6d1e93b7f5a24',
      plainTags: ['세포 주기'],
      collections: [['분자생물학', '7장 · 세포 주기']],
      copies: [{ name: '세포생물학 3장 (수정본 2026-10-30 1412).pdf', at: '2026. 10. 30. 오후 2:12' }],
    },
  };

  return { tags, plainTags, dimTags, collections, items, selectedItem, outline, cues, memos, tutor, trash, duplicates, edited };
})();
