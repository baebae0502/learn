import { beforeEach, describe, expect, it } from 'vitest';
import { useTagEdit } from './tagEdit';

beforeEach(() => useTagEdit.setState({ editingId: null, text: '', opener: null, busy: false, restoreTo: null }));

describe('the one tag name being typed', () => {
  it('begins with a name, keeps the text typed, and ends leaving the focus to be given back to the chip', () => {
    const opener = {} as Element; // the test runs without a DOM
    useTagEdit.getState().begin('t1', '중요', opener);
    useTagEdit.getState().setText('중요한 것');
    expect(useTagEdit.getState()).toMatchObject({ editingId: 't1', text: '중요한 것', busy: false });
    useTagEdit.getState().end();
    const s = useTagEdit.getState();
    expect([s.editingId, s.opener, s.busy]).toEqual([null, null, false]);
    expect(s.restoreTo).toEqual({ tagId: 't1', opener });
    s.clearRestore();
    expect(useTagEdit.getState().restoreTo).toBeNull();
  });
  it('hands the focus to another chip (a merge) or to none (a click elsewhere), and beginning again forgets an old restore', () => {
    useTagEdit.getState().begin('t1', 'a', null);
    useTagEdit.getState().end('t2');
    expect(useTagEdit.getState().restoreTo).toEqual({ tagId: 't2', opener: null });
    useTagEdit.getState().begin('t1', 'a', null);
    expect(useTagEdit.getState().restoreTo).toBeNull();
    useTagEdit.getState().end(false);
    expect(useTagEdit.getState().restoreTo).toBeNull();
    useTagEdit.getState().end(); // nothing to end
    expect(useTagEdit.getState().restoreTo).toBeNull();
  });
  it('ignores text and busy marks when nothing is being edited', () => {
    useTagEdit.getState().setText('x');
    expect(useTagEdit.getState().text).toBe('');
  });
});
