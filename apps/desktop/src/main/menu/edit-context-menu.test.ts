import type { EditFlags } from 'electron';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() } }));

const { editContextMenuTemplate } = await import('./edit-context-menu');

const flags = (over: Partial<EditFlags> = {}): EditFlags => ({
  canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canDelete: false, canSelectAll: false,
  canEditRichly: false, ...over,
});
const rows = (t: ReturnType<typeof editContextMenuTemplate>) =>
  t?.map((i) => (i.type === 'separator' ? '-' : `${i.role}:${i.label}:${i.enabled ? 'on' : 'off'}`)) ?? null;

describe('edit context menu', () => {
  it('shows nothing outside editable fields when nothing is selected', () => {
    expect(editContextMenuTemplate({ isEditable: false, selectionText: '', editFlags: flags({ canSelectAll: true }) })).toBeNull();
  });

  it('editable field: cut/copy/paste/select all following editFlags', () => {
    expect(rows(editContextMenuTemplate({ isEditable: true, selectionText: '', editFlags: flags({ canPaste: true, canSelectAll: true }) }))).toEqual([
      'cut:오려두기:off',
      'copy:복사하기:off',
      'paste:붙여넣기:on',
      '-',
      'selectAll:모두 선택:on',
    ]);
    expect(rows(editContextMenuTemplate({
      isEditable: true, selectionText: 'abc', editFlags: flags({ canCut: true, canCopy: true, canPaste: false, canSelectAll: true }),
    }))).toEqual(['cut:오려두기:on', 'copy:복사하기:on', 'paste:붙여넣기:off', '-', 'selectAll:모두 선택:on']);
  });

  it('read-only selection: copy only', () => {
    expect(rows(editContextMenuTemplate({ isEditable: false, selectionText: '선택한 글', editFlags: flags({ canCopy: true, canSelectAll: true }) })))
      .toEqual(['copy:복사하기:on']);
  });
});
