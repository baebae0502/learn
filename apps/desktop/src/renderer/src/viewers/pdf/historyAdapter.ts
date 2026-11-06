/**
 * What pdf.js's link service calls on the history it is given (pdf_viewer.mjs: goToDestination, goToPage and the named
 * actions GoBack / GoForward). The reader's own history (history.ts) is behind it.
 */
export interface LinkHistory {
  pushCurrentPosition(): void;
  push(destination: unknown): void;
  pushPage(pageNumber: number): void;
  back(): void;
  forward(): void;
}

export function linkHistory(on: { jump(pageNumber: number): void; back(): void; forward(): void }): LinkHistory {
  return {
    // The service asks for the present position and then for the new one; one jump writes both (recordJump keeps where the reader is).
    pushCurrentPosition: () => undefined,
    push: (destination) => on.jump((destination as { pageNumber: number }).pageNumber),
    pushPage: (pageNumber) => on.jump(pageNumber),
    back: () => on.back(),
    forward: () => on.forward(),
  };
}
