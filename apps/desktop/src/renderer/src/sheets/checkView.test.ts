import { describe, expect, it } from 'vitest';
import type { CheckRow, LibraryCheckPayload } from '@learn/domain';
import { checkBadge, checkHintShown, checkIntro, checkRowView } from './checkView';

const HOME = '/Users/seojin';
const todo = (over: Partial<CheckRow> & Pick<CheckRow, 'kind'>): CheckRow => ({ state: 'todo', count: 1, bytes: 0, entries: [], fix: null, keys: [], ...over });
const done = (kind: CheckRow['kind'], fix: CheckRow['fix']): CheckRow => ({ kind, state: 'done', count: 0, bytes: 0, entries: [], fix, keys: [] });
const payload = (over: Partial<LibraryCheckPayload> = {}): LibraryCheckPayload => ({ kind: 'libraryCheck', mode: 'auto', items: 128, rows: [], homeDir: HOME, failed: null, ...over });
const A = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const B = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';

describe('the check sheet\'s rows (spec 7.2, approved mockups recovery and recovery-full)', () => {
  it('임시 파일: its count, the sentence, the size, one button', () => {
    expect(checkRowView(todo({ kind: 'staging', count: 2, bytes: 4_120_000 }), HOME, 'darwin')).toEqual({
      kind: 'staging', count: 2, state: 'todo', tone: 'warning', title: '가져오다 멈춘 임시 파일 2개',
      text: '라이브러리에는 추가되지 않았습니다. 정리하면 디스크 공간을 돌려받습니다.', meta: '4.1 MB', metaTail: null,
      buttons: [{ key: 'cleanStaging', label: '임시 파일 정리' }], entries: [], more: 0,
    });
  });

  it('쓰이지 않는 사본: 자료로 되살리기 and 정리…, the size', () => {
    const v = checkRowView(todo({ kind: 'unreferenced', count: 3, bytes: 96_000 }), HOME, 'darwin');
    expect([v.title, v.text, v.meta, v.tone]).toEqual(['쓰이지 않는 사본 3개', '어느 자료도 쓰지 않는 라이브러리 폴더의 파일입니다.', '96 KB', 'warning']);
    expect(v.buttons).toEqual([{ key: 'revive', label: '자료로 되살리기' }, { key: 'askClean', label: '정리…' }]);
  });

  it('사본이 사라진 자료: two names, each with its own 다시 연결…, then 외 N개; no button on the row', () => {
    const v = checkRowView(todo({ kind: 'missingManaged', count: 4, entries: [{ itemId: A, label: '분자생물학 5장 · 막 수송', path: null }, { itemId: B, label: 'Second Messengers at a Glance', path: null }] }), HOME, 'darwin');
    expect(v.title).toBe('사본이 사라진 자료 4개');
    expect(v.text).toBe('라이브러리 폴더에서 사본 파일이 없어졌습니다.');
    expect(v.buttons).toEqual([]);
    expect(v.meta).toBeNull();
    expect(v.entries).toEqual([
      { key: A, label: '분자생물학 5장 · 막 수송', path: null, pathTitle: null, relinkItemId: A },
      { key: B, label: 'Second Messengers at a Glance', path: null, pathTitle: null, relinkItemId: B },
    ]);
    expect(v.more).toBe(2);
  });

  it('외부 연결: the title, and under it the path home-relative with the whole path as its tooltip', () => {
    const v = checkRowView(todo({ kind: 'missingLinked', entries: [{ itemId: A, label: 'Calcium Signaling Revisited', path: `${HOME}/Downloads/papers/calcium-signaling.pdf` }] }), HOME, 'darwin');
    expect([v.title, v.text]).toEqual(['원본을 찾을 수 없는 외부 연결 1개', '파일을 옮겼다면 새 위치를 지정하세요.']);
    expect(v.entries).toEqual([{ key: A, label: 'Calcium Signaling Revisited', path: '~/Downloads/papers/calcium-signaling.pdf', pathTitle: `${HOME}/Downloads/papers/calcium-signaling.pdf`, relinkItemId: A }]);
    expect(v.more).toBe(0);
  });

  it('손상된 사본 and 주인 없는 수정본 are information: the name and size (외 N개 for more), Finder에서 보기 — 폴더에서 보기 off macOS', () => {
    const corrupt = checkRowView(todo({ kind: 'corrupt', bytes: 4_200_000, entries: [{ itemId: null, label: '분자생물학 6장 · 신호 전달', path: null }] }), HOME, 'darwin');
    expect([corrupt.tone, corrupt.title, corrupt.meta]).toEqual(['info', '따로 보관한 손상된 사본 1개', '분자생물학 6장 · 신호 전달 · 4.2 MB']);
    expect(corrupt.text).toBe('내용이 손상되어 라이브러리에서 뺀 사본입니다. 확인한 뒤 직접 지울 수 있습니다.');
    expect(corrupt.buttons).toEqual([{ key: 'revealCorrupt', label: 'Finder에서 보기' }]);
    expect(corrupt.entries).toEqual([]);
    expect(checkRowView(todo({ kind: 'corrupt', count: 3, bytes: 900, entries: [{ itemId: null, label: 'sample', path: null }] }), HOME, 'linux').meta).toBe('sample 외 2개 · 900 B');
    expect(checkRowView(todo({ kind: 'corrupt', bytes: 900 }), HOME, 'linux')).toMatchObject({ meta: '900 B', buttons: [{ key: 'revealCorrupt', label: '폴더에서 보기' }] });
    const edits = checkRowView(todo({ kind: 'orphanEdits', bytes: 3_100, entries: [{ itemId: null, label: '단백질 접힘 정리 (수정본 2026-10-18 2210).pdf', path: null }] }), HOME, 'linux');
    expect([edits.tone, edits.title, edits.meta]).toEqual(['info', '주인 없는 수정본 1개', '단백질 접힘 정리 (수정본 2026-10-18 2210).pdf · 3.1 KB']);
    expect(edits.metaTail).toBe(' · 3.1 KB');
    expect(edits.meta!.endsWith(edits.metaTail!)).toBe(true);
    expect(edits.text).toBe('다른 앱에서 고쳤지만 원래 자료가 없는 파일입니다.');
    expect(edits.buttons).toEqual([{ key: 'importOrphanEdits', label: '새 자료로 가져오기' }, { key: 'revealOrphanEdit', label: '폴더에서 보기' }]);
  });

  it('a row fixed in the sheet keeps its place as an ok row: its name without a count, and how it was fixed', () => {
    expect(checkRowView(done('staging', 'cleaned'), HOME, 'darwin')).toEqual({
      kind: 'staging', count: 0, state: 'done', tone: 'success', title: '가져오다 멈춘 임시 파일', text: '정리했습니다.', meta: null, metaTail: null, buttons: [], entries: [], more: 0,
    });
    expect(checkRowView(done('unreferenced', 'revived'), HOME, 'darwin').text).toBe('자료로 되살렸습니다.');
    expect(checkRowView(done('missingManaged', 'relinked'), HOME, 'darwin')).toMatchObject({ title: '사본이 사라진 자료', text: '다시 연결했습니다.' });
    expect(checkRowView(done('orphanEdits', 'imported'), HOME, 'darwin').text).toBe('새 자료로 가져왔습니다.');
    expect(checkRowView(done('corrupt', 'none'), HOME, 'darwin')).toMatchObject({ title: '따로 보관한 손상된 사본', text: '남은 것이 없습니다.' });
  });
});

describe('the sheet\'s head and foot (spec 7.1–7.2, Task 1 rulings)', () => {
  const rows = [todo({ kind: 'staging' })];
  it('automatic: what was found without a cause, the hint to the menu, the warning badge', () => {
    const p = payload({ rows });
    expect(checkIntro(p)).toBe('라이브러리를 열 때 정리할 것을 찾았습니다. 자동으로 지운 것은 없습니다.');
    expect(checkHintShown(p)).toBe(true);
    expect(checkBadge(p)).toBe('warning');
  });
  it('from the menu: the same finding for the library, and no hint (the menu was just used)', () => {
    const p = payload({ mode: 'manual', rows });
    expect(checkIntro(p)).toBe('라이브러리에서 정리할 것을 찾았습니다. 자동으로 지운 것은 없습니다.');
    expect(checkHintShown(p)).toBe(false);
  });
  it('nothing wrong: 문제가 없습니다 and the success badge; once every row is fixed the badge is success too', () => {
    const fine = payload({ mode: 'manual' });
    expect([checkIntro(fine), checkBadge(fine), checkHintShown(fine)]).toEqual(['문제가 없습니다.', 'success', false]);
    expect(checkBadge(payload({ rows: [done('staging', 'cleaned')] }))).toBe('success');
  });
});
