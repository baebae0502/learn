import type { ToolChip, ToolOutcome } from '@learn/domain';

/** One chip over an answer: what Learn's tools did in this turn (spec 8.3). `from` and `to` are 0-based page indexes. */
export type ChipView = { kind: 'selection' | 'position' | 'outline' | 'refused' | 'unread' } | { kind: 'read' | 'reading'; from: number; to: number };

/** The outcomes that returned what was asked: pages read (a duplicate too — spec 5.2), the context, the outline. */
const DONE: ReadonlySet<ToolOutcome> = new Set<ToolOutcome>(['ok', 'limited', 'duplicate']);

/** Page runs that overlap or touch, joined, in page order. */
function runs(spans: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * The chips of a turn's tool records (P-12), in the order each kind first came: get_context by whether the question carried a
 * selection, the outline, every page read joined into runs where the first read was, a refusal, a read that returned no pages. Each
 * kind once. `running` (a call not yet recorded) adds "N쪽 읽는 중" when it is a read; a context or outline call is too quick to show.
 */
export function mergeToolChips(chips: readonly ToolChip[], running: ToolChip | null = null): ChipView[] {
  const order: Array<ChipView | 'reads'> = [];
  const seen = new Set<string>();
  const once = (key: string, view: ChipView | 'reads') => {
    if (seen.has(key)) return;
    seen.add(key);
    order.push(view);
  };
  const read: Array<[number, number]> = [];
  for (const c of chips) {
    if (c.outcome === 'refused') once('refused', { kind: 'refused' });
    else if (c.tool === 'read_pdf_pages') {
      if (DONE.has(c.outcome) && c.pageFrom !== null) {
        once('reads', 'reads');
        read.push([c.pageFrom, c.pageTo ?? c.pageFrom]);
      } else once('unread', { kind: 'unread' });
    } else if (DONE.has(c.outcome)) {
      if (c.tool === 'get_outline') once('outline', { kind: 'outline' });
      else once('context', { kind: c.withSelection ? 'selection' : 'position' });
    }
  }
  const joined = runs(read);
  const views = order.flatMap((v): ChipView[] => (v === 'reads' ? joined.map(([from, to]) => ({ kind: 'read', from, to })) : [v]));
  if (running?.tool === 'read_pdf_pages' && running.pageFrom !== null) views.push({ kind: 'reading', from: running.pageFrom, to: running.pageTo ?? running.pageFrom });
  return views;
}
