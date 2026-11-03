import type { EventBus } from 'pdfjs-dist/web/pdf_viewer.mjs';

/**
 * What the pdf.js find controller is told. Case is ignored and diacritics are not matched, so a query typed in NFC finds
 * the same word in a page whose text is NFD; `highlightAll` marks every match, the current one differently.
 */
export function dispatchFind(bus: EventBus, query: string, type: '' | 'again', previous = false): void {
  bus.dispatch('find', {
    source: null,
    type,
    query: query.normalize('NFC'),
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: previous,
    matchDiacritics: false,
  });
}

/** The selected text as a query: whitespace folded, at most 100 characters (a whole paragraph is not a search). */
export function selectionQuery(selection: Selection | null): string {
  return (selection?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, 100).trim();
}
