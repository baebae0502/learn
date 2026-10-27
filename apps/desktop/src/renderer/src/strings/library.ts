import { VIDEO_FORMATS } from '@learn/domain';
import { waGwa } from './josa';

export const library = {
  table: '자료 목록',
  listFailed: '자료 목록을 불러오지 못했습니다',
  type: { pdf: 'PDF', video: '동영상' },
  /** 보관 column (spec §3.1): the user's words, never the internal "managed" (design-spec 9). */
  storage: { managed: '사본', linked: '외부 연결' },
  linked: '외부 파일 연결',
  missing: '파일 없음',
  missingTitle: '원본\u00a0파일을 찾을 수 없습니다',
  importButton: '가져오기',
  emptyTitle: '아직 자료가 없습니다',
  // "이 창": determiner + noun bound with U+00A0 (design-spec 9), as in library-empty.html.
  emptyBody1: 'PDF나 동영상을 이\u00a0창에 끌어다 놓거나 가져올 파일을 선택하세요.',
  emptyBody2: '원본은 그대로 두고 라이브러리에 사본을 만듭니다.',
  /** The empty library while a drop's files are being brought in (critique T13R2-m1). */
  importingTitle: (n: number) => `자료 ${n}개를 가져오는 중…`,
  formats: `PDF와 ${VIDEO_FORMATS} 동영상을 지원합니다.`,
  /** The table body while the first list read takes longer than 300 ms (design-spec 6; the header stays). */
  loading: '불러오는 중…',
  /** A column edge's accessible name (its separator, which VoiceOver reads with the width). */
  resizeColumn: (column: string) => `${column} 열 폭`,
  /** The toolbar's quick search (spec 7.1): the fields it reads that a person names. */
  searchPlaceholder: '제목, 저자, 태그 검색',
  /** Read out politely as the results change; with none, the no-results state speaks instead. */
  searchStatus: (n: number) => `일치하는 자료 ${n}개`,
  /** In the table body's place when nothing matches (spec 4.3). */
  searchEmptyTitle: (query: string) => `‘${query}’${waGwa(query)} 일치하는 자료가 없습니다`,
  /**
   * Where the search looked (spec 7.1): in 내 라이브러리 the fields; in any other view that view's name first ("‘분자생물학’의 …").
   * With a tag filter on, how many tags narrowed the result (spec 3.6).
   */
  searchEmptyBody: (view: string | null, tagCount: number) =>
    `${view === null ? '' : `‘${view}’의 `}제목·저자·태그·출판사·원래 이름·초록·메모에서 찾았습니다.${tagCount > 0 ? ` 고른 태그 ${tagCount}개로 거른 결과입니다.` : ''}`,
  searchClear: '검색어 지우기',
} as const;
