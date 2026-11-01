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
  /** The backup's toast (dialogs.html?scene=jobs). */
  backingUp: '백업을 만드는 중',
  /** Under 앞의 작업을 기다리는 중 (Q-4e): what comes next, naming the job ahead when this window knows it. */
  importAfter: { backup: '백업이 끝나면 가져오기를 시작합니다.', restore: '복원이 끝나면 가져오기를 시작합니다.' },
  backupAfter: { import: '가져오기가 끝나면 백업을 시작합니다.', restore: '복원이 끝나면 백업을 시작합니다.', other: '앞의 작업이 끝나면 백업을 시작합니다.' },
  /** How a backup run ends in its toast; a done one is said by its result sheet. */
  backupCancelled: '백업을 취소했습니다',
  backupCancelledBody: '만들던 백업 폴더는 남기지 않았습니다.',
  backupFailed: '백업을 만들지 못했습니다',
  /** The restore's toast (spec 9.1): the same machine as the backup's. */
  restoring: '복원하는 중',
  restoreAfter: { import: '가져오기가 끝나면 복원을 시작합니다.', backup: '백업이 끝나면 복원을 시작합니다.', other: '앞의 작업이 끝나면 복원을 시작합니다.' },
  /** How a restore run ends in its toast; a done one is said by its result sheet. */
  restoreCancelled: '복원을 취소했습니다',
  restoreCancelledBody: '만들던 라이브러리 폴더는 남기지 않았습니다.',
  restoreDone: '복원을 마쳤습니다',
  /** Only when the result sheet could not open: where the new library is. */
  restoreDoneBody: (folder: string): string => `결과 창을 열지 못했습니다. 새 라이브러리는 \u201c${folder}\u201d 폴더에 있습니다.`,
  restoreFailed: '복원하지 못했습니다',
  cancel: '취소',
} as const;
