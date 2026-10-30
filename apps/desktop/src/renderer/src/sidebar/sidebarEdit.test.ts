import { beforeEach, describe, expect, it } from 'vitest';
import { useSidebarEdit } from './sidebarEdit';

const reset = () => useSidebarEdit.setState({ edit: null, opener: null, busy: false, restoreTo: null });
beforeEach(reset);

describe('the sidebar\'s one edit at a time', () => {
  it('begins with a name, keeps the text typed, and ends leaving the focus to be given back', () => {
    const opener = {} as Element; // the test runs without a DOM
    useSidebarEdit.getState().begin({ kind: 'rename', id: 'c1', text: '통계' }, opener);
    useSidebarEdit.getState().setText('통계학');
    expect(useSidebarEdit.getState().edit).toEqual({ kind: 'rename', id: 'c1', text: '통계학' });
    useSidebarEdit.getState().end();
    const s = useSidebarEdit.getState();
    expect([s.edit, s.opener, s.busy]).toEqual([null, null, false]);
    expect(s.restoreTo).toEqual({ opener });
    s.clearRestore();
    expect(useSidebarEdit.getState().restoreTo).toBeNull();
  });
  it('ending with no edit leaves nothing to restore; ending after a click elsewhere asks for no restore; beginning again forgets an old restore', () => {
    useSidebarEdit.getState().end();
    expect(useSidebarEdit.getState().restoreTo).toBeNull();
    useSidebarEdit.getState().begin({ kind: 'new', parentId: null, text: 'x' }, {} as Element);
    useSidebarEdit.getState().end(false);
    expect(useSidebarEdit.getState().restoreTo).toBeNull();
    useSidebarEdit.setState({ restoreTo: { opener: null } });
    useSidebarEdit.getState().begin({ kind: 'new', parentId: null, text: 'x' });
    expect(useSidebarEdit.getState().restoreTo).toBeNull();
  });
});
