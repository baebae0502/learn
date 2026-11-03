import type { PdfAnchor } from './anchors';
import { codePointOffset } from './anchor-text';

export interface WebAnnotationTarget { source: string; selector: Array<Record<string, unknown>> }

/** The anchor as a W3C Web Annotation target; text positions are counted in code points of `pageText`. */
export function toWebAnnotation(anchor: PdfAnchor, opts: { source: string; pageText?: string }): WebAnnotationTarget {
  const selector: Array<Record<string, unknown>> = [
    { type: 'FragmentSelector', conformsTo: 'http://tools.ietf.org/rfc/rfc3778', value: `page=${anchor.pageIndex + 1}` },
  ];
  const { text } = anchor;
  if (text) {
    selector.push({ type: 'TextQuoteSelector', exact: text.quote.exact, prefix: text.quote.prefix, suffix: text.quote.suffix });
    if (text.position && opts.pageText !== undefined) {
      selector.push({
        type: 'TextPositionSelector',
        start: codePointOffset(opts.pageText, text.position.start),
        end: codePointOffset(opts.pageText, text.position.end),
      });
    }
  }
  return { source: opts.source, selector };
}
