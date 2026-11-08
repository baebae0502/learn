import { activePageField } from '../readerScope';

/** Focuses the active reader's page field with its number selected; nothing while the field is not there or cannot be used. */
export function focusPageField(): void {
  const field = activePageField();
  if (!field || field.disabled) return;
  field.focus();
  field.select();
}
