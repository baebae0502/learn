import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@learn/domain';
import { shortcutGroups } from './shortcuts';

describe('shortcut sheet content (design-spec 7.4 from the registry)', () => {
  it('lists every registry shortcut exactly once, app → library → reader, then the dialog keys', () => {
    const groups = shortcutGroups('darwin');
    const labels = groups.flatMap((g) => g.rows.map((r) => r.label));
    for (const c of COMMANDS.filter((x) => x.accelerator || x.key)) expect(labels.filter((l) => l === c.label), c.id).toHaveLength(1);
    expect(groups.map((g) => g.title)).toEqual(['앱', '라이브러리', '리더', '대화상자']);
    expect(groups[1]!.rows[0]).toEqual({ label: '파일 가져오기…', keys: ['⌘', 'O'], spoken: '⌘O' });
  });
  it('uses the Linux bindings off macOS', () => {
    const app = shortcutGroups('linux')[0]!;
    expect(app.rows.find((r) => r.label === '사이드바 보기/가리기')?.keys).toEqual(['Ctrl', 'Shift', 'S']);
  });
  it('spells the dialog keys the way the platform does (↩ esc on macOS, Enter Esc elsewhere)', () => {
    const dialogKeys = (platform: string) => shortcutGroups(platform).at(-1)!.rows.map((r) => [r.label, r.keys, r.spoken]);
    expect(dialogKeys('darwin')).toEqual([['기본 버튼 누르기', ['↩'], '↩'], ['닫기', ['esc'], 'esc']]);
    expect(dialogKeys('linux')).toEqual([['기본 버튼 누르기', ['Enter'], 'Enter'], ['닫기', ['Esc'], 'Esc']]);
  });
});
