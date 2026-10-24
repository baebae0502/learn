import { LIBRARY_COLUMNS } from '@learn/domain';
import { formatDate, formatSize } from '../format';
import { t } from '../strings';
import { afterPaintOr, type Pending } from '../ui/afterPaint';

/** The type roles the table, the item panel and the import toast are drawn in (base.css .t-*). */
const ROLES = ['t-body', 't-caption', 't-footnote', 't-headline', 't-title3'] as const;

/**
 * Pays, at an idle moment, what a window otherwise pays inside the frame of its first rows (spec 8, the drop stall):
 * the Korean collation and time-format data the table's sort and date cells load on first use, and the faces and glyph
 * runs of its type roles in both weights: Hangul, Latin and tabular digits. The probe is laid out unseen (visibility
 * hidden, off screen, aria-hidden) and removed once a frame has been painted. Returns its cancel.
 */
export function warmUp(doc: Document): Pending {
  new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }).compare('가', 'a');
  formatDate(new Date(0).toISOString());
  formatSize(1_234_567);
  const text = `${LIBRARY_COLUMNS.map((c) => c.label).join(' ')} ${t.shell.myLibrary} ${t.toast.imported(8)} 0123456789 AaGg`;
  const probe = doc.createElement('div');
  probe.className = 'font-warm';
  probe.setAttribute('aria-hidden', 'true');
  for (const role of ROLES) {
    for (const strong of [false, true]) {
      const line = doc.createElement('span');
      line.className = strong ? `${role} strong` : role;
      line.textContent = text;
      probe.append(line);
    }
  }
  doc.body.append(probe);
  const stop = afterPaintOr(1000, () => probe.remove());
  return () => {
    stop();
    probe.remove();
  };
}
