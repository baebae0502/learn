import { describe, expect, it } from 'vitest';
import { commandById, type CommandSpec } from '@learn/domain';
import { rankCommands } from './rank';

const C: CommandSpec[] = [
  { id: 'file.importManaged', label: '파일 가져오기…', keywords: ['가져오기', 'import'], contexts: ['library'] },
  { id: 'file.importLinked', label: '외부 파일 연결…', keywords: ['연결', 'link'], contexts: ['library'] },
  { id: 'nav.back', label: '라이브러리로 돌아가기', keywords: ['뒤로', 'back'], contexts: ['viewer'] },
];
const ids = (q: string) => rankCommands(C, q, 'darwin').map((r) => r.command.id);

describe('rankCommands', () => {
  it('keeps registry order for an empty query', () => {
    expect(ids('')).toEqual(['file.importManaged', 'file.importLinked', 'nav.back']);
  });
  it('puts label matches before keyword-only matches, best kind first', () => {
    expect(ids('파일')).toEqual(['file.importManaged', 'file.importLinked']); // prefix before word
    expect(ids('ㄱㅈ')).toEqual(['file.importManaged']);
    expect(ids('import')).toEqual(['file.importManaged']);
    expect(ids('ㄷㄹ')).toEqual(['nav.back']); // keyword 뒤로 by 초성 (the label has no ㄷㄹ run)
  });
  it('highlights only label matches', () => {
    expect(rankCommands(C, '가져', 'darwin')[0]!.match).toEqual({ start: 3, end: 5, kind: 'word' });
    expect(rankCommands(C, 'back', 'darwin')[0]!.match).toBeNull();
  });
  it('finds nothing for an unrelated query', () => {
    expect(ids('효소 억제제')).toEqual([]);
  });
  it('matches the state label the menu shows now (사이드바 가리기 / 사이드바 보기), not the neutral name', () => {
    const toggle = [commandById('view.toggleSidebar')];
    expect(rankCommands(toggle, '가리기', 'darwin', { sidebar: 'shown' })[0]!.match).toEqual({ start: 5, end: 8, kind: 'word' });
    // Hidden, the label is 사이드바 보기: 가리기 is only a search word, so nothing is marked.
    expect(rankCommands(toggle, '가리기', 'darwin', { sidebar: 'hidden' })).toEqual([{ command: toggle[0], match: null }]);
    expect(rankCommands(toggle, 'ㅅㅇㄷㅂ ㅂ', 'darwin', { sidebar: 'hidden' })[0]!.match).toEqual({ start: 0, end: 6, kind: 'initials' });
  });
});
