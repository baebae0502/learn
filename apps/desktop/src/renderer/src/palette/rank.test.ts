import { describe, expect, it } from 'vitest';
import { COMMANDS, commandById, inPalette, type CommandId, type CommandSpec } from '@learn/domain';
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
  it('matches the item panel toggle by the name its own pane state gives it (P-3)', () => {
    const panel: CommandSpec = { id: 'nav.back', label: '항목 패널 보기/가리기', stateLabels: { inspector: { shown: '항목 패널 가리기', hidden: '항목 패널 보기' } }, keywords: ['항목 패널'], contexts: ['library'] };
    expect(rankCommands([panel], '가리기', 'darwin', { inspector: 'shown' })[0]!.match).toEqual({ start: 6, end: 9, kind: 'word' });
    expect(rankCommands([panel], '가리기', 'darwin', { inspector: 'hidden', sidebar: 'shown' })).toEqual([]);
  });
  it('puts the five commands run most recently first for an empty query, then the rest in registry order (spec §4.4)', () => {
    const listed = COMMANDS.filter(inPalette);
    const recent: CommandId[] = ['view.textSmaller', 'view.textBigger', 'app.settings', 'app.shortcuts', 'view.toggleSidebar', 'file.importLinked'];
    const got = rankCommands(listed, '', 'darwin', {}, recent).map((r) => r.command.id);
    expect(got.slice(0, 5)).toEqual(recent.slice(0, 5));
    expect(got.slice(5)).toEqual(listed.map((c) => c.id).filter((id) => !recent.slice(0, 5).includes(id)));
    // A recent command that cannot run now (not listed) is skipped; the next one takes its place.
    expect(rankCommands(C, '', 'darwin', {}, ['view.textBigger', 'nav.back']).map((r) => r.command.id)).toEqual(['nav.back', 'file.importManaged', 'file.importLinked']);
  });
  it('lets the more recent command win a tie for a query, never a better match', () => {
    const two = [commandById('view.textBigger'), commandById('view.textSmaller')];
    const order = (recent: CommandId[]) => rankCommands(two, 'ㄱㅈ', 'darwin', {}, recent).map((r) => r.command.id);
    expect(order([])).toEqual(['view.textBigger', 'view.textSmaller']); // both initials at 0: registry order
    expect(order(['view.textSmaller'])).toEqual(['view.textSmaller', 'view.textBigger']);
    // 파일: the prefix match stays above the word match however recent the other one is.
    expect(rankCommands(C, '파일', 'darwin', {}, ['file.importLinked']).map((r) => r.command.id)).toEqual(['file.importManaged', 'file.importLinked']);
  });
});
