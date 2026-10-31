/** Work in progress (spec 3.3, mockup importToast): the progress toast's title, its count, the bar's value. */
export const jobs = {
  importing: '가져오는 중',
  waitingChoice: '확인을 기다리는 중',
  waitingJob: '앞의 작업을 기다리는 중',
  /** Under 앞의 작업을 기다리는 중: what comes next (Task 9 may name the work, Q-4e). */
  waitingJobNote: '앞의 작업이 끝나면 가져오기를 시작합니다.',
  /** After the title, on its line: " · 7 / 12" (files finished / put in). */
  count: (done: number, total: number) => ` · ${done} / ${total}`,
  /** Under 앞의 작업을 기다리는 중: the files that will be imported, in place of a progress that has not begun. */
  countTotal: (total: number) => ` · ${total}개`,
  percent: (pct: number) => `${pct}%`,
  /** The bar's value as read out (aria-valuetext). */
  progressValue: (done: number, total: number, pct: number) => `파일 ${total}개 중 ${done}개, ${pct}%`,
  cancel: '취소',
} as const;
