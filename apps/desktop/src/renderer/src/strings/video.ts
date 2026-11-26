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
} as const;
