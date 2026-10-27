import { waGwa } from './josa';

/** ⌘K palette: 자료 (with a query) above 명령 (design-spec 10.5, palette.html, spec §4.4). */
export const palette = {
  dialogLabel: '명령 팔레트',
  /** It finds items and commands (M4); the launcher says the same (shell.launcher). */
  inputLabel: '검색 및 명령',
  placeholder: '검색 및 명령',
  /** The listbox; its groups are named by their headers. */
  listLabel: '검색 결과',
  groups: { items: '자료', collections: '컬렉션', commands: '명령' },
  /** 와/과 by the query's last syllable, as the quick search's no-results title (josa.ts). */
  emptyTitle: (query: string) => `‘${query}’${waGwa(query)} 일치하는 자료·컬렉션·명령이 없습니다`,
  /** `example`: 초성 → word from the library's titles, or ㅅㅈ → 설정 (palette/items.ts initialsExample). */
  emptyBody: (example: string) => `초성으로도 찾을 수 있습니다. 예: ${example}`,
  example: (initials: string, word: string) => `${initials} → ${word}`,
  /** The last row of 명령 while there is a query: the quick search takes the query over (⌘F). */
  searchLibrary: (query: string) => `라이브러리에서 ‘${query}’ 검색`,
  /** The same sentence in three pieces, so the row can mark the query between the quotes. */
  searchLibraryParts: (query: string): [string, string, string] => ['라이브러리에서 ‘', query, '’ 검색'],
  /** A collection row's secondary text (palette.html): "분자생물학 안 · 14개", or "14개" for a top-level collection. */
  collectionMeta: (parent: string | null, count: number) => (parent === null ? `${count}개` : `${parent} 안 · ${count}개`),
  /** While an import or a sheet holds the window: what is unavailable, then why and what next. */
  busyTitle: '지금은 명령을 실행할 수 없습니다',
  busyBody: '진행 중인 작업이 있습니다. 작업이 끝나면 다시 쓸 수 있습니다.',
  /**
   * The same hold while a command that still runs (설정…) is listed under it: the header says why the rest is missing
   * and when it comes back, not that nothing runs.
   */
  busyHeaderTitle: '진행 중인 작업이 있습니다',
  busyHeaderBody: '작업이 끝나면 다른\u00a0명령도 쓸 수 있습니다.',
  /** Read out (polite) with that header: the hold, then how many commands are listed. */
  busyStatus: (n: number) => `진행 중인 작업이 있습니다. 실행할 수 있는 명령 ${n}개`,
  /** Read out (polite) when the results change. */
  resultCount: (items: number, collections: number, commands: number) =>
    [items > 0 ? `자료 ${items}개` : '', collections > 0 ? `컬렉션 ${collections}개` : '', commands > 0 ? `명령 ${commands}개` : ''].filter((part) => part !== '').join(', '),
  footMove: '이동',
  /** ↩ on a command row (and the demo overlay's pill). */
  footRun: '실행',
  /** ↩ on an item row. */
  footOpen: '열기',
  footClose: '닫기',
  footHint: (example: string) => `초성 검색 지원 · ${example}`,
} as const;
