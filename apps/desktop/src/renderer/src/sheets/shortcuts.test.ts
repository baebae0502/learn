import { describe, expect, it } from 'vitest';
import { COMMANDS, acceleratorLabel, tagSlot } from '@learn/domain';
import { shortcutColumns, shortcutGroups } from './shortcuts';

describe('shortcut sheet content (design-spec 7.4 from the registry)', () => {
  it('lists every registry shortcut, each in one row (a pair line stands for its two commands), then the palette and dialog keys', () => {
    const groups = shortcutGroups('darwin');
    const spoken = groups.flatMap((g) => g.rows.map((r) => r.spoken));
    // ⌘2…⌘8 are hidden menu items inside the "⌘1…⌘8 / ⌘9" line.
    for (const c of COMMANDS.filter((x) => x.accelerator && tagSlot(x.id) === null && !/^tab\.goTo[2-8]$/.test(x.id))) {
      const key = acceleratorLabel(c.accelerator!, 'darwin');
      expect(spoken.filter((sp) => sp.split(/ \/ |부터 /).includes(key)), c.id).toHaveLength(1);
    }
    expect(groups.map((g) => g.title)).toEqual(['앱', '라이브러리', '자료', '정리', '탭', '리더', '팔레트·대화상자']);
    expect(groups[1]!.rows[0]).toEqual({ label: '파일 가져오기… / 외부 파일 연결…', keys: ['⌘', 'O'], pairKeys: ['⌥', '⌘', 'O'], spoken: '⌘O / ⌥⌘O' });
    // The one row that is not a registry command: the system's 전체 화면 (design-spec 7.4), marked as such.
    const system = groups.flatMap((g) => g.rows).filter((r) => r.system);
    expect(system).toEqual([{ label: '전체 화면', keys: ['⌃', '⌘', 'F'], spoken: '⌃⌘F', system: true }]);
    expect(COMMANDS.some((c) => c.label === '전체 화면')).toBe(false);
  });
  it('lists the tab keys in their own 탭 group as the pair lines of the key map (design-spec 7.4)', () => {
    const tabs = (platform: string) => shortcutGroups(platform).find((g) => g.title === '탭')!.rows;
    expect(tabs('darwin')).toEqual([
      { label: '탭 닫기 / 닫은 탭 다시 열기', keys: ['⌘', 'W'], pairKeys: ['⇧', '⌘', 'T'], spoken: '⌘W / ⇧⌘T' },
      { label: '다음 / 이전 탭', keys: ['⌃', '⇥'], pairKeys: ['⌃', '⇧', '⇥'], spoken: '⌃⇥ / ⌃⇧⇥' },
      { label: '라이브러리 · 2…8번째 탭 / 마지막 탭', keys: ['⌘', '1–8'], pairKeys: ['⌘', '9'], spoken: '⌘1부터 ⌘8 / ⌘9' },
    ]);
    expect(tabs('linux').at(-1)).toEqual({ label: '라이브러리 · 2…8번째 탭 / 마지막 탭', keys: ['Ctrl', '1–8'], pairKeys: ['Ctrl', '9'], spoken: 'Ctrl+1부터 Ctrl+8 / Ctrl+9' });
    expect(tabs('linux')[0]).toMatchObject({ label: '탭 닫기 / 닫은 탭 다시 열기', keys: ['Ctrl', 'W'], pairKeys: ['Ctrl', 'Shift', 'T'] });
  });
  it('names ⌘+ ⌘− ⌘0 by the view the sheet was opened from (P-9)', () => {
    const named = (view?: 'library' | 'viewer') => {
      const rows = shortcutGroups('darwin', view).flatMap((g) => g.rows);
      return ['⌘+ / ⌘−', '⌘0'].map((spoken) => rows.find((r) => r.spoken === spoken)?.label);
    };
    expect(named('viewer')).toEqual(['확대 / 축소', '실제 크기']);
    expect(named('library')).toEqual(['글자 크게 / 작게', '기본 글자 크기']);
    expect(named()).toEqual(['글자 크게 / 작게', '기본 글자 크기']);
  });
  it('names ⌘F by the view the sheet was opened from: 찾기 in the reader, 빠른 검색 elsewhere', () => {
    const named = (view?: 'library' | 'viewer') => shortcutGroups('darwin', view).flatMap((g) => g.rows).find((r) => r.spoken === '⌘F')?.label;
    expect(named('viewer')).toBe('찾기');
    expect(named('library')).toBe('빠른 검색');
    expect(named()).toBe('빠른 검색');
  });
  it('groups the keys the library and the reader share under the sheet\'s own view: moved, never listed twice (final review m-1)', () => {
    const shared = ['⌘F', '⌘+ / ⌘−', '⌘0'];
    const where = (view?: 'library' | 'viewer') => {
      const groups = shortcutGroups('darwin', view);
      const spoken = groups.flatMap((g) => g.rows.map((r) => r.spoken));
      for (const s of shared) expect(spoken.filter((x) => x === s), `${view}: ${s}`).toHaveLength(1);
      return Object.fromEntries(groups.map((g) => [g.title, g.rows.filter((r) => shared.includes(r.spoken)).length]));
    };
    expect(where('viewer')).toMatchObject({ 라이브러리: 0, 리더: 3 });
    expect(where('library')).toMatchObject({ 라이브러리: 3, 리더: 0 });
    expect(where()).toMatchObject({ 라이브러리: 3, 리더: 0 });
  });
  it('keeps the sheet within the 770 px bound in both views, and under 740 so the next pair line fits (the natural height is the taller column plus 136 px of title, foot and padding)', () => {
    const height = (view?: 'library' | 'viewer') => Math.max(...shortcutColumns(shortcutGroups('darwin', view)).map((c) => c.reduce((h, g, i) => h + 31 + 29 * g.rows.length + (i > 0 ? 16 : 0), 0)));
    expect(height()).toBe(height('library'));
    for (const view of ['library', 'viewer'] as const) {
      expect(height(view) + 136, view).toBeLessThanOrEqual(740);
      expect(height(view) + 136, view).toBeLessThanOrEqual(770);
    }
  });
  it('uses the Linux bindings off macOS', () => {
    const app = shortcutGroups('linux')[0]!;
    expect(app.rows.find((r) => r.label === '사이드바 보기/가리기')?.keys).toEqual(['Ctrl', 'Shift', 'S']);
  });
  it('spells the palette and dialog keys the way the platform does (↩ esc on macOS, Enter Esc elsewhere; design-spec 7.4)', () => {
    const dialogKeys = (platform: string) => shortcutGroups(platform).at(-1)!.rows.map((r) => [r.label, r.keys, r.spoken]);
    expect(dialogKeys('darwin')).toEqual([['이동', ['↑', '↓'], '↑ ↓'], ['실행', ['↩'], '↩'], ['닫기', ['esc'], 'esc']]);
    expect(dialogKeys('linux')).toEqual([['이동', ['↑', '↓'], '↑ ↓'], ['실행', ['Enter'], 'Enter'], ['닫기', ['Esc'], 'Esc']]);
  });
  it('lists the app commands in design-spec 7.4 order (⌘, ⌘K ⌘/ ⌃⌘S), whatever the registry order (R-10), then F6 / ⇧F6 (8.3)', () => {
    const app = shortcutGroups('darwin')[0]!;
    expect(app.rows.map((r) => r.label)).toEqual(['설정…', '명령 팔레트…', '단축키 도움말', '사이드바 보기/가리기', '다음 / 이전 패널로 이동', '전체 화면']);
    expect(app.rows.at(-2)).toEqual({ label: '다음 / 이전 패널로 이동', keys: ['F6'], pairKeys: ['⇧', 'F6'], spoken: 'F6 / ⇧F6' });
    const linux = shortcutGroups('linux')[0]!.rows;
    expect(linux.at(-2)).toEqual({ label: '다음 / 이전 패널로 이동', keys: ['F6'], pairKeys: ['Shift', 'F6'], spoken: 'F6 / Shift+F6' });
    // Off macOS the item is Electron's togglefullscreen role, on F11.
    expect(linux.at(-1)).toEqual({ label: '전체 화면', keys: ['F11'], spoken: 'F11', system: true });
    expect(app.rows[0]).toEqual({ label: '설정…', keys: ['⌘', ','], spoken: '⌘,' });
    expect(app.rows[1]).toEqual({ label: '명령 팔레트…', keys: ['⌘', 'K'], spoken: '⌘K' });
  });
  it('lists ⌘+ / ⌘− / ⌘0 under 라이브러리 (design-spec 7.4), after the import commands', () => {
    const library = shortcutGroups('darwin')[1]!;
    expect(library.rows.map((r) => r.label)).toEqual(['파일 가져오기… / 외부 파일 연결…', '빠른 검색', '항목 패널 보기/가리기', '글자 크게 / 작게', '기본 글자 크기', '휴지통 비우기…']);
    // ⌥⌘I under its neutral name: the sheet shows no pane state (design-spec 7.4).
    expect(library.rows[2]).toEqual({ label: '항목 패널 보기/가리기', keys: ['⌥', '⌘', 'I'], spoken: '⌥⌘I' });
    expect(shortcutGroups('linux')[1]!.rows[2]).toEqual({ label: '항목 패널 보기/가리기', keys: ['Ctrl', 'Alt', 'I'], spoken: 'Ctrl+Alt+I' });
    expect(library.rows.slice(3, 5).map((r) => [r.keys, r.pairKeys])).toEqual([[['⌘', '+'], ['⌘', '−']], [['⌘', '0'], undefined]]); // U+2212 on the keycap, as in the menu
    expect(library.rows.at(-1)).toEqual({ label: '휴지통 비우기…', keys: ['⇧', '⌘', '⌫'], spoken: '⇧⌘⌫' });
  });
  it('lists the selected item\'s shortcuts (⇧⌘R, ⌘⌫) in their own 자료 group, after 라이브러리 (design-spec 7.4)', () => {
    const item = (platform: string) => shortcutGroups(platform).find((g) => g.title === '자료')!.rows;
    expect(item('darwin')).toEqual([{ label: '새\u00a0탭에서 열기', keys: ['⌘', '↩'], spoken: '⌘↩' }, { label: 'Finder에서 보기', keys: ['⇧', '⌘', 'R'], spoken: '⇧⌘R' }, { label: '휴지통으로 이동', keys: ['⌘', '⌫'], spoken: '⌘⌫' }]);
    expect(item('linux')).toEqual([{ label: '새\u00a0탭에서 열기', keys: ['Ctrl', 'Enter'], spoken: 'Ctrl+Enter' }, { label: '폴더에서 보기', keys: ['Ctrl', 'Shift', 'R'], spoken: 'Ctrl+Shift+R' }, { label: '휴지통으로 이동', keys: ['Ctrl', 'Backspace'], spoken: 'Ctrl+Backspace' }]);
  });
  it('lists 새 컬렉션 and folds the eight colour keys into one line, 1–8, under 정리 after 자료 (M5 spec 9.3, spec 4.2)', () => {
    const organize = (platform: string) => shortcutGroups(platform).find((g) => g.title === '정리')!.rows;
    expect(organize('darwin')).toEqual([
      { label: '새\u00a0컬렉션', keys: ['⇧', '⌘', 'N'], spoken: '⇧⌘N' },
      { label: '색 태그 붙이기/떼기', keys: ['1–8'], spoken: '1부터 8' },
    ]);
    expect(organize('linux')).toEqual([
      { label: '새\u00a0컬렉션', keys: ['Ctrl', 'Shift', 'N'], spoken: 'Ctrl+Shift+N' },
      { label: '색 태그 붙이기/떼기', keys: ['1–8'], spoken: '1부터 8' },
    ]);
    const titles = shortcutGroups('darwin').map((g) => g.title);
    expect(titles.indexOf('정리')).toBe(titles.indexOf('자료') + 1);
    // The eight registry rows are not listed apart, in 자료 or anywhere.
    expect(shortcutGroups('darwin').flatMap((g) => g.rows).filter((r) => /^색 태그 \d$/.test(r.label))).toEqual([]);
  });
  it('lays the groups out in two columns read down then across, never splitting a group, the taller as short as it can be', () => {
    for (const platform of ['darwin', 'linux']) {
      const groups = shortcutGroups(platform);
      const [left, right] = shortcutColumns(groups);
      expect([...left, ...right], platform).toEqual(groups); // every group whole, in ORDER
      expect(left.map((g) => g.title), platform).toEqual(['앱', '라이브러리', '자료']);
      expect(right.map((g) => g.title), platform).toEqual(['정리', '탭', '리더', '팔레트·대화상자']);
    }
    const group = (rows: number) => ({ title: `${rows}`, rows: Array.from({ length: rows }, (_, i) => ({ label: `${i}`, keys: [], spoken: '' })) });
    expect(shortcutColumns([group(12), group(2), group(2), group(2)]).map((c) => c.length)).toEqual([1, 3]);
    expect(shortcutColumns([group(2), group(2), group(2), group(12)]).map((c) => c.length)).toEqual([3, 1]);
    expect(shortcutColumns([group(3)]).map((c) => c.length)).toEqual([1, 0]);
  });
  it('marks ↑ ↓ as alternative keys (drawn apart), every other row as one chord', () => {
    const rows = shortcutGroups('darwin').flatMap((g) => g.rows);
    expect(rows.filter((r) => r.alternatives).map((r) => r.label)).toEqual(['이동']);
  });
});
