/** A page number typed in the field: digits only, within the document; anything else is not a page. */
export function parsePage(text: string | null, total: number): number | null {
  if (text === null || !/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= total ? n : null;
}
