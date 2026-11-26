/** The video reader's words (spec 6.2, 12): control names and tooltips, the speed menu, the states. 합니다체, U+00A0 where a unit sticks to its number. */
export const video = {
  /** The reader's sidebar while there is no transcript to show (an unplayable video, a file that did not open, until the transcript pane arrives). */
  noTranscript: '표시할 대본이 없습니다',
  /** Read after the stage's name when it has the focus. */
  stageHint: '스페이스로 재생',
  opening: '여는 중…',
  controls: '재생 컨트롤',
  scrubber: '재생 위치',
  back10: '10초 뒤로',
  forward10: '10초 앞으로',
  play: '재생',
  pause: '일시정지',
  speed: '재생 속도',
  /** The speed button's name: its visible text stays inside it. */
  speedName: (rate: number) => `재생 속도 ${rate}×`,
  mute: '음소거',
  unmute: '음소거 해제',
  volume: '음량',
  /** "1.25×": the speed as the button and the menu name it; a whole number has no decimals. */
  rate: (rate: number) => `${rate}×`,
  /** The strip's name (spec 6.1): it holds the subtitle menu. */
  toolbar: '동영상 도구',
  /** 자막 ▾ (spec 6.5, 12): the menu's name, the button's states, and the items. */
  captions: '자막',
  /** The button's accessible name while a track shows: its visible text is the track's name alone. */
  captionsNamed: (name: string) => `자막: ${name}`,
  captionsOff: '자막 끔',
  noCaptions: '자막 없음',
  captionsOffItem: '끄기',
  addSubtitles: '자막\u00a0파일 추가…',
  removeSubtitle: '이\u00a0자막 제거',
  /** A track with no language: "자막 2" is its place in the order (spec 3.8). */
  untitledTrack: (n: number) => `자막 ${n}`,
  /** 붙이기 토스트 (spec 5.4, 12). */
  attached: (n: number) => `자막 ${n}개를 붙였습니다`,
  alreadyAttached: '이미 붙어 있는 자막입니다',
  attachFailedTitle: (n: number) => `자막 ${n}개를 붙이지 못했습니다`,
  attachFailed: {
    unreadable: '글자 인코딩을 알아볼 수 없습니다',
    'no-cues': '자막 문장을 찾지 못했습니다',
    'too-large': '자막\u00a0파일이 너무 큽니다(5\u00a0MB까지)',
    'too-many-cues': '자막 문장이 너무 많습니다(2만\u00a0개까지)',
    'not-subtitle': '자막\u00a0파일(SRT\u00a0· VTT)만 붙일 수 있습니다',
    unpaired: '자막\u00a0파일은 동영상에 붙입니다',
    'video-failed': '동영상을 가져오지 못해 자막도 붙이지 않았습니다',
    io: '파일을 읽지 못했습니다',
  },
  /** The next action under the failure rows: by what failed (spec 12). */
  nextEncoding: 'UTF-8로 저장한 뒤 다시 붙이세요.',
  nextFormat: 'SRT\u00a0· VTT 형식인지 확인하세요.',
  nextBoth: 'UTF-8로 저장한 뒤 다시 붙이세요. SRT\u00a0· VTT 형식인지도 확인하세요.',
  /** For a file that is no subtitle or has no video beside it: where subtitles are put on. */
  nextWhere: '동영상 탭에 끌어\u00a0놓거나 자막 메뉴의 ‘자막\u00a0파일\u00a0추가…’\u2060로 붙이세요.',
  /** ‘한국어’ 자막을 제거했습니다 (+ 실행 취소). */
  removed: (name: string) => `‘${name}’ 자막을 제거했습니다`,
} as const;
