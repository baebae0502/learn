import { IMAGE_FORMATS, VIDEO_FORMATS } from '@learn/domain';
import { waGwa } from './josa';

/**
 * The fields the quick search reads (spec 7.1). U+2060 before each "·": a line may end with the dot, never start with it
 * (U+00B7 is no non-starter under line-break: strict, and keep-all only joins letters).
 */
const SEARCHED_FIELDS = ['제목', '저자', '태그', '출판사', '원래\u00a0이름', '초록', '메모'].join('\u2060·');

export const library = {
  table: '자료 목록',
  progressLabel: '읽은 만큼',
  progressDone: '완료',
  progressDoneLabel: '끝까지 읽음',
  listFailed: '자료 목록을 불러오지 못했습니다',
  type: { pdf: 'PDF', video: '동영상', image: '이미지' },
  /** 보관 column (spec §3.1): the user's words, never the internal "managed" (design-spec 9). */
  storage: { managed: '사본', linked: '외부 연결' },
  linked: '외부 파일 연결',
  missing: '파일 없음',
  missingTitle: '원본\u00a0파일을 찾을 수 없습니다',
  importButton: '가져오기',
  emptyTitle: '아직 자료가 없습니다',
  // "이 창": determiner + noun bound with U+00A0 (design-spec 9), as in library-empty.html.
  emptyBody1: 'PDF\u2060·동영상\u2060·이미지를 이\u00a0창에 끌어다 놓거나 가져올 파일을 선택하세요.',
  emptyBody2: '원본은 그대로 두고 라이브러리에 사본을 만듭니다.',
  /** The empty library while a drop's files are being brought in (critique T13R2-m1). */
  importingTitle: (n: number) => `자료 ${n}개를 가져오는 중…`,
  formats: `PDF, ${VIDEO_FORMATS} 동영상, ${IMAGE_FORMATS} 이미지를 지원합니다.`,
  /** The table body while the first list read takes longer than 300 ms (design-spec 6; the header stays). */
  loading: '불러오는 중…',
  /** A column edge's accessible name (its separator, which VoiceOver reads with the width). */
  resizeColumn: (column: string) => `${column} 열 폭`,
  /** The toolbar's quick search (spec 7.1): the fields it reads that a person names. */
  searchPlaceholder: '제목, 저자, 태그 검색',
  /** The same in the scope 정보와 본문 (M7c spec 5.8): 240 wide, it still fits beside the scope button. */
  searchPlaceholderFull: '제목, 저자, 태그, 본문 검색',
  /**
   * The quick search's scope button and its menu (M7c spec 5.8, 11): the item panel's '정보' names the fields, so a person
   * reads 정보 for them (design-spec 9: no internal words). The last line counts the PDFs whose body is indexed.
   */
  scope: {
    label: '검색 범위',
    metadata: '정보',
    metadataDescription: SEARCHED_FIELDS,
    fulltext: '정보와 본문',
    fulltextDescription: 'PDF 본문 포함',
    progress: (done: number, total: number) => `본문 색인 ${done}\u00a0/\u00a0${total}`,
  },
  /** Read out politely as the results change; with none, the no-results state speaks instead. */
  searchStatus: (n: number) => `일치하는 자료 ${n}개`,
  /** In the table body's place when nothing matches (spec 4.3). */
  searchEmptyTitle: (query: string) => `‘${query}’\u2060${waGwa(query)} 일치하는 자료가 없습니다`,
  /**
   * Where the search looked (spec 7.1): in 내 라이브러리 the fields; in any other view that view's name first ("‘분자생물학’의 …").
   * `body`: the PDFs' body text was searched too (said only when it was: no-results must not read as a false negative). With a tag filter on, how many tags
   * narrowed the result (spec 3.6).
   */
  searchEmptyBody: (view: string | null, tagCount: number, body: boolean) =>
    `${view === null ? '' : `‘${view}’\u2060의 `}${SEARCHED_FIELDS}${body ? '\u2060·PDF\u00a0본문' : ''}에서 찾았습니다.${tagCount > 0 ? ` 고른 태그\u00a0${tagCount}개로 거른 결과입니다.` : ''}`,
  /** In 정보와 본문, a query of one-letter words only: the body was not searched, and why. */
  searchEmptyOneLetter: '본문은 두\u00a0글자 이상인 낱말로 찾습니다.',
  /** In 정보와 본문 while PDFs are still being indexed: the body search may find more later. */
  searchEmptyIndexing: (done: number, total: number) => `본문 색인이 끝나면 더 찾을 수 있습니다(${done}\u00a0/\u00a0${total}).`,
  searchClear: '검색어 지우기',
} as const;
