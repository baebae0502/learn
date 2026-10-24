import { useLayoutEffect, useState } from 'react';
import { afterPaintOr } from './afterPaint';

/** False until a frame with this component's first commit has been painted (or 100 ms where no frames come), then true. */
export function usePaintedOnce(): boolean {
  const [painted, setPainted] = useState(false);
  useLayoutEffect(() => afterPaintOr(100, () => setPainted(true)), []);
  return painted;
}
