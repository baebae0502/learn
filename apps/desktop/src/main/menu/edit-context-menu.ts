import { BrowserWindow, Menu, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { mainStrings } from '../strings';

type Params = Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>;

/**
 * Native cut/copy/paste/select-all for text fields and selected text; null (no menu) anywhere else.
 * Enabled states come from Chromium's `editFlags`; cut/paste only make sense where the text is editable.
 */
export function editContextMenuTemplate(p: Params): MenuItemConstructorOptions[] | null {
  const copy = mainStrings.menu.edit;
  if (p.isEditable) {
    return [
      { role: 'cut', label: copy.cut, enabled: p.editFlags.canCut },
      { role: 'copy', label: copy.copy, enabled: p.editFlags.canCopy },
      { role: 'paste', label: copy.paste, enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: copy.selectAll, enabled: p.editFlags.canSelectAll },
    ];
  }
  if (p.selectionText) return [{ role: 'copy', label: copy.copy, enabled: p.editFlags.canCopy }];
  return null;
}

/** Elements that handle `contextmenu` themselves (e.g. library rows) call preventDefault, so this never fires for them. */
export function attachEditContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const template = editContextMenuTemplate(params);
    if (!template) return;
    const window = BrowserWindow.fromWebContents(contents) ?? undefined;
    Menu.buildFromTemplate(template).popup({ window, frame: params.frame ?? undefined });
  });
}
