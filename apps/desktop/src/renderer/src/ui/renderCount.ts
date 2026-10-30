/**
 * E2E only: a page that wants to know which components render sets `window.__learnRenders = {}` (tests/e2e/helpers.ts
 * watchRenders), and each call then adds one to that component's count. React's Profiler reports nothing in the production
 * build the E2E runs, so this is the measure that can fail. A normal run never creates the object: a call is one property read.
 */
export function countRender(component: string): void {
  const counts = (globalThis as { __learnRenders?: Record<string, number> }).__learnRenders;
  if (counts !== undefined) counts[component] = (counts[component] ?? 0) + 1;
}
