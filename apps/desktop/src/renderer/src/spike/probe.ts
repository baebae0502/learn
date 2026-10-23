// The table spike's measuring window (window.__spike), read by tests/evidence/table-spike.evidence.ts. Branch m4-spike only.

export interface SpikeMark {
  name: string;
  /** performance.now() when the mark was taken (after the frame that shows the change, see TableSpike's usePaintMark). */
  at: number;
  /** item-row elements in the DOM at that moment. */
  rows: number;
}

export interface SpikeProbe {
  impl: 'rac' | 'tanstack';
  /** Rows the page generated. */
  total: number;
  marks: SpikeMark[];
  /** performance.now() of the last pointerdown or keydown (window, capture phase). */
  inputAt: number;
  /** Row actions (double-click, ↩): item ids in call order. */
  opened: string[];
  /** Context-menu targets in table order, one array per right-click. */
  menus: string[][];
  /** Column widths at each onResizeEnd (a number once a column has been resized, else its defined size). */
  resizeEnds: Array<Record<string, number | string>>;
  /** onResize calls (while dragging). */
  resizeMoves: number;
  /** Renders of the memoised cell contents. */
  cellRenders: number;
  /** Calls of TableBody's row function (our code building row elements; RAC caches them per row object). */
  rowElements: number;
  /** The collator sort itself, ms, one entry per header click. */
  sortComputeMs: number[];
  /** True: a plain printable key on the table is stopped before the grid's type-ahead sees it. */
  guardTypeAhead: boolean;
  /** True: plain Home / End are sent on as ⌘/Ctrl+Home / End, which RAC's grid takes to the first / last row from a cell too. */
  globalHomeEnd: boolean;
  /**
   * Replaces the rows shown: all of them, the ~6 % whose title starts with 세포 (a search), or the current rows with
   * the third one a new object (a refresh in which one item changed). Returns performance.now() at the change.
   */
  setRows(kind: 'all' | 'filter' | 'refresh-one'): number;
  /** Changes the layout's row height (the density); returns performance.now() at the change. */
  setRowHeight(px: 24 | 28 | 32): number;
  /** The selected ids in table order. */
  selectedIds(): string[];
}

declare global {
  interface Window {
    __spike?: SpikeProbe;
  }
}
