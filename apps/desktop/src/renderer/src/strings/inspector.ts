// The item panel (spec §5, design-spec 2.5). 합니다체; U+00A0 binds a number and its unit, a kind and its count, so the
// stats line breaks only at its middots (design-spec 4). SHA-256 is named in the file section only (design-spec 9
// 기술 값; strings.test.ts allows exactly fileSha and copySha).
export const inspector = {
  /** The right slot's name: the panel and its resize handle, as 사이드바 names the left one. */
  panel: '항목 패널',
  loading: '불러오는 중…',
  detailFailed: '자료 정보를 불러오지 못했습니다',
  /** Under detailFailed: no internal code, the retry is the next action. */
  detailFailedBody: '잠시 뒤 다시 시도해 주세요.',
  /** The head's kind line: "PDF · 68쪽" (the duration comes from format.ts formatDuration). */
  pages: (n: number) => `${n}쪽`,
  /** Nothing selected (library.html?state=none); reading progress joins the sentence in M7. */
  noneTitle: '선택한 자료 없음',
  noneBody: '표에서 자료를 고르면 정보가 여기에 보입니다.',
  /** "내 라이브러리 · 자료 48개(PDF 35 · 동영상 13) · 1.9 GB"; `kinds` and `size` arrive bound (summary.ts). */
  stats: (scope: string, count: number, kinds: string, size: string) => `${scope} · 자료 ${count}개(${kinds}) · ${size}`,
  kindCount: (kind: string, n: number) => `${kind} ${n}`,
  kindItems: (kind: string, n: number) => `${kind} ${n}개`,
  total: (size: string) => `합계 ${size}`,
  /** Several selected (library.html?state=multi): the title and the "외 N개" line under the first eight titles. */
  multiTitle: (n: number) => `자료 ${n}개 선택`,
  more: (n: number) => `외 ${n}개`,
  sections: { info: '정보', file: '파일' },
  fields: {
    creators: '저자',
    date: '날짜',
    /** A date that is a year only reads as one (spec §5.3 "연도만 있으면 연도"). */
    year: '연도',
    publisher: '출판사',
    language: '언어',
    url: 'URL',
    abstract: '초록',
    extra: '메모',
    createdAt: '추가일',
    updatedAt: '수정일',
  },
  roles: { author: '저자', editor: '편집자', lecturer: '강연자', other: '기타' },
  /** A creator who is not an author: "윤재하 (편집자)". */
  creatorWithRole: (name: string, role: string) => `${name} (${role})`,
  monthDate: (y: number, m: number) => `${y}. ${m}.`,
  dayDate: (y: number, m: number, d: number) => `${y}. ${m}. ${d}.`,
  /** No info at all yet: what writing it gives (the pencil beside 정보 is the way, once editing exists). */
  noInfo: '저자와 연도를 적어 두면 표에서 정렬하고 찾을 수 있습니다.',
  showMore: '더 보기',
  showLess: '접기',
  file: { storage: '보관', size: '크기', originalName: '원래 이름', location: '위치' },
  /** 보관 values (design-spec 9: "관리형" → "사본"). */
  storage: { managed: '사본 · 라이브러리 안', linked: '외부 연결' },
  fileSha: 'SHA-256',
  copySha: '전체 SHA-256 복사',
  /** The copy button's tooltip for 1.5 s after a copy (spec §5.3: no toast). */
  copied: '복사했습니다',
  copyFailedTitle: '복사하지 못했습니다',
  copyFailedBody: '클립보드에 쓸 수 없습니다. 창을 한 번 누른 뒤 다시 복사하세요.',
} as const;
