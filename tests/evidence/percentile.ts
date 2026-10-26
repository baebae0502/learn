/** Nearest-rank percentile `p` (0–100) of `xs`: a value that was measured, never an interpolation. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) throw new Error('percentile: no values');
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

/** The upper middle value (perf.json's median since M3: sorted[⌊n/2⌋]). */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('median: no values');
  return [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
}
