/** The pages around the current one that are drawn before the others on screen. */
const NEAR = 3;

/** The pages to draw, the nearest to the current page first: ±3 around it, then the rest of what is on screen. */
export function drawOrder(visible: readonly number[], current: number): number[] {
  const near = (n: number) => Math.abs(n - current) <= NEAR;
  return [...visible].sort((a, b) => Number(near(b)) - Number(near(a)) || Math.abs(a - current) - Math.abs(b - current));
}
