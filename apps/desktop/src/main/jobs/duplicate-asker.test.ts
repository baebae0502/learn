import { describe, expect, it, vi } from 'vitest';
import type { DuplicateCard, SheetPayload, SheetResult } from '@learn/domain';
import { createDuplicateAsker } from './duplicate-asker';

const EXISTING: DuplicateCard = { title: '분자생물학 6장', type: 'pdf', size: 4200, createdAt: '2026-10-20T11:40:00.000Z', storageMode: 'managed' };
const question = (remaining: number) => ({ fileName: 'molbio.pdf', existing: EXISTING, remaining });
function win(id: number, focused = true) {
  const w = {
    webContents: { id },
    focused,
    isFocused: () => w.focused,
    focus: vi.fn(() => {
      w.focused = true;
    }),
  };
  return w;
}
type W = ReturnType<typeof win>;
function asker(opts: { windows?: W[]; current?: W | null; result?: SheetResult | null | Promise<SheetResult | null>; box?: { response: number; checkboxChecked: boolean } }) {
  const sheets: Array<{ parent: W; payload: SheetPayload }> = [];
  const boxes: unknown[] = [];
  const ask = createDuplicateAsker<W>({
    windowOf: (id) => opts.windows?.find((w) => w.webContents.id === id) ?? null,
    anyMainWindow: () => opts.current ?? null,
    sheet: async (parent, payload) => {
      sheets.push({ parent, payload });
      return opts.result === undefined ? { kind: 'duplicate', choice: 'add', applyToRest: true } : await opts.result;
    },
    messageBox: async (options) => {
      boxes.push(options);
      return opts.box ?? { response: 1, checkboxChecked: false };
    },
  });
  return { ask, sheets, boxes };
}
const live = () => new AbortController().signal;

describe('the duplicate question (spec 3.4, P-1)', () => {
  it('asks on the window that put the file in, brought forward first when it is in the background, with how many are left', async () => {
    const owner = win(7, false);
    const a = asker({ windows: [owner], current: win(8) });
    expect(await a.ask(7, question(2), live())).toEqual({ choice: 'add', applyToRest: true, askedOn: 7 });
    expect(owner.focus).toHaveBeenCalledTimes(1);
    expect(a.sheets).toEqual([{ parent: owner, payload: { kind: 'duplicate', fileName: 'molbio.pdf', existing: EXISTING, remaining: 2 } }]);
  });

  it('that window gone: on the main window there is now', async () => {
    const now = win(8);
    const a = asker({ windows: [], current: now });
    expect(await a.ask(7, question(0), live())).toMatchObject({ askedOn: 8 });
    expect(a.sheets[0]!.parent).toBe(now);
  });

  it('no main window at all: a message box of its own — 새 자료로 추가 or 건너뛰기, the box ticked', async () => {
    const a = asker({ windows: [], current: null, box: { response: 0, checkboxChecked: true } });
    expect(await a.ask(7, question(3), live())).toEqual({ choice: 'add', applyToRest: true, askedOn: null });
    expect(a.boxes).toEqual([{
      type: 'question',
      message: '이미 라이브러리에 있는 파일입니다',
      detail: 'molbio.pdf의 내용이 ‘분자생물학 6장’ 자료와 완전히 같습니다. 어느\u00a0쪽을 골라도 원본\u00a0파일은 지우지 않습니다.',
      buttons: ['새\u00a0자료로 추가', '건너뛰기'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      checkboxLabel: '남은 중복 파일 3개에도 같은 선택 적용',
      checkboxChecked: true,
    }]);
    expect(a.sheets).toEqual([]);
  });

  it('with nothing left there is no box to tick, and applyToRest is false whatever comes back', async () => {
    const a = asker({ windows: [win(7)], result: { kind: 'duplicate', choice: 'skip', applyToRest: true } });
    expect(await a.ask(7, question(0), live())).toEqual({ choice: 'skip', applyToRest: false, askedOn: 7 });
    const b = asker({ current: null, box: { response: 1, checkboxChecked: true } });
    expect(await b.ask(7, question(0), live())).toEqual({ choice: 'skip', applyToRest: false, askedOn: null });
    expect(b.boxes[0]).not.toHaveProperty('checkboxLabel');
  });

  it('a sheet that closed without an answer is 건너뛰기 for this file only', async () => {
    const a = asker({ windows: [win(7)], result: null });
    expect(await a.ask(7, question(2), live())).toEqual({ choice: 'skip', applyToRest: false, askedOn: null });
  });

  it('stops waiting when the import is stopped (취소 or quitting), and asks nothing once it has been', async () => {
    const a = asker({ windows: [win(7)], result: new Promise<SheetResult | null>(() => {}) });
    const stop = new AbortController();
    const answer = a.ask(7, question(2), stop.signal);
    stop.abort();
    expect(await answer).toEqual({ choice: 'skip', applyToRest: false, askedOn: null });
    const late = new AbortController();
    late.abort();
    expect(await a.ask(7, question(2), late.signal)).toEqual({ choice: 'skip', applyToRest: false, askedOn: null });
    expect(a.sheets).toHaveLength(1);
  });
});
