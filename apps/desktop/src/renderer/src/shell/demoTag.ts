/** A box on screen, as tagSpot reads the content area and the library table's last row. */
export interface Box {
  left: number;
  top: number;
  width: number;
  bottom: number;
}

/** Room kept under the tag at the content area's foot (its own height and a gap). */
const FOOT = 48;

/**
 * Where the demo overlay's lasting tag sits, in client px. Where the library's table shows (its last row on screen), over the table's
 * empty area under the rows: at the content's top-left it covered the header row's 제목. Elsewhere (the reader), the content area's
 * top-left under its header band, where the drop overlay the tag first came with lies. Null without a content area shown: the
 * window's own corner then (demo.css).
 */
export function tagSpot(content: Box | null, band: number, lastRow: Box | null): { left: number; top: number } | null {
  if (!content || content.width <= 0) return null;
  const left = Math.round(content.left + 16);
  if (lastRow && lastRow.width > 0) return { left, top: Math.round(Math.min(lastRow.bottom + 16, content.bottom - FOOT)) };
  return { left, top: Math.round(content.top + band + 12) };
}
