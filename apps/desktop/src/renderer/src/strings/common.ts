export const common = {
  close: '닫기',
  clear: '지우기',
  done: '완료',
  cancel: '취소',
  notifications: '알림',
  retry: '다시 시도',
  today: '오늘',
  yesterday: '어제',
  /** An empty or unreadable value in a table cell. */
  noValue: '—',
  /** Why a control is disabled while an import or a sheet holds the window (M-2). */
  busy: '진행 중인 작업이 끝나면 쓸 수 있습니다',
  /** How long work took (format.ts formatElapsed): "38초", "2분 5초", "1시간 4분". */
  elapsed: {
    seconds: (s: number) => `${s}초`,
    minutes: (m: number, s: number) => (s > 0 ? `${m}분 ${s}초` : `${m}분`),
    hours: (h: number, m: number) => (m > 0 ? `${h}시간 ${m}분` : `${h}시간`),
  },
} as const;
