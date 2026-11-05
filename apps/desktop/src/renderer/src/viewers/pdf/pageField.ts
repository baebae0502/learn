let field: HTMLInputElement | null = null;

/** The ref of the toolbar's page field: ⌥⌘G reaches it from outside the toolbar. */
export const pageFieldRef = (el: HTMLInputElement | null): void => {
  field = el;
};

/** Focuses the page field with its number selected; nothing while the field is not there or cannot be used. */
export function focusPageField(): void {
  if (!field || field.disabled) return;
  field.focus();
  field.select();
}
