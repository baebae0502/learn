import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@learn/domain';
import { shortcutColumns, shortcutGroups } from './shortcuts';

describe('shortcut sheet content (design-spec 7.4 from the registry)', () => {
  it('lists every registry shortcut exactly once, app → library → reader, then the palette and dialog keys', () => {
    const groups = shortcutGroups('darwin');
    const labels = groups.flatMap((g) => g.rows.map((r) => r.label));
    for (const c of COMMANDS.filter((x) => x.accelerator || x.key)) expect(labels.filter((l) => l === c.label), c.id).toHaveLength(1);
    expect(groups.map((g) => g.title)).toEqual(['앱', '라이브러리', '자료', '리더', '팔레트·대화상자']);
    expect(groups[1]!.rows[0]).toEqual({ label: '파일 가져오기…', keys: ['⌘', 'O'], spoken: '⌘O' });
    // The one row that is not a registry command: the system's 전체 화면 (design-spec 7.4), marked as such.
    const system = groups.flatMap((g) => g.rows).filter((r) => r.system);
    expect(system).toEqual([{ label: '전체 화면', keys: ['⌃', '⌘', 'F'], spoken: '⌃⌘F', system: true }]);
    expect(COMMANDS.some((c) => c.label === '전체 화면')).toBe(false);
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
    expect(app.rows.map((r) => r.label)).toEqual(['설정…', '명령 팔레트…', '단축키 도움말', '사이드바 보기/가리기', '다음 패널로 이동', '이전 패널로 이동', '전체 화면']);
    expect(app.rows.slice(-3, -1)).toEqual([
      { label: '다음 패널로 이동', keys: ['F6'], spoken: 'F6' },
      { label: '이전 패널로 이동', keys: ['⇧', 'F6'], spoken: '⇧F6' },
    ]);
    const linux = shortcutGroups('linux')[0]!.rows;
    expect(linux.at(-2)).toEqual({ label: '이전 패널로 이동', keys: ['Shift', 'F6'], spoken: 'Shift+F6' });
    // Off macOS the item is Electron's togglefullscreen role, on F11.
    expect(linux.at(-1)).toEqual({ label: '전체 화면', keys: ['F11'], spoken: 'F11', system: true });
    expect(app.rows[0]).toEqual({ label: '설정…', keys: ['⌘', ','], spoken: '⌘,' });
    expect(app.rows[1]).toEqual({ label: '명령 팔레트…', keys: ['⌘', 'K'], spoken: '⌘K' });
  });
  it('lists ⌘+ / ⌘− / ⌘0 under 라이브러리 (design-spec 7.4), after the import commands', () => {
    const library = shortcutGroups('darwin')[1]!;
    expect(library.rows.map((r) => r.label)).toEqual(['파일 가져오기…', '외부 파일 연결…', '새\u00a0컬렉션', '빠른 검색', '항목 패널 보기/가리기', '글자 크게', '글자 작게', '기본 글자 크기']);
    // ⌥⌘I under its neutral name: the sheet shows no pane state (design-spec 7.4).
    expect(library.rows[4]).toEqual({ label: '항목 패널 보기/가리기', keys: ['⌥', '⌘', 'I'], spoken: '⌥⌘I' });
    expect(shortcutGroups('linux')[1]!.rows[4]).toEqual({ label: '항목 패널 보기/가리기', keys: ['Ctrl', 'Alt', 'I'], spoken: 'Ctrl+Alt+I' });
    expect(library.rows.slice(5).map((r) => r.keys)).toEqual([['⌘', '+'], ['⌘', '−'], ['⌘', '0']]); // U+2212 on the keycap, as in the menu
  });
  it('lists the selected item\'s shortcut (⇧⌘R) in its own 자료 group, after 라이브러리 (design-spec 7.4)', () => {
    const item = (platform: string) => shortcutGroups(platform).find((g) => g.title === '자료')!.rows;
    expect(item('darwin')).toEqual([{ label: 'Finder에서 보기', keys: ['⇧', '⌘', 'R'], spoken: '⇧⌘R' }]);
    expect(item('linux')).toEqual([{ label: '폴더에서 보기', keys: ['Ctrl', 'Shift', 'R'], spoken: 'Ctrl+Shift+R' }]);
  });
  it('lays the groups out in two columns read down then across, never splitting a group, the taller as short as it can be', () => {
    for (const platform of ['darwin', 'linux']) {
      const groups = shortcutGroups(platform);
      const [left, right] = shortcutColumns(groups);
      expect([...left, ...right], platform).toEqual(groups); // every group whole, in ORDER
      expect(left.map((g) => g.title), platform).toEqual(['앱', '라이브러리']);
      expect(right.map((g) => g.title), platform).toEqual(['자료', '리더', '팔레트·대화상자']);
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
