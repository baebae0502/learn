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

export function linkHistory(on: { jump(): void; back(): void; forward(): void }): LinkHistory {
  return {
    // The service asks for the present position and then for the new one; one jump writes both (recordJump keeps where the reader is).
    pushCurrentPosition: () => undefined,
    push: () => on.jump(),
    pushPage: () => on.jump(),
    back: () => on.back(),
    forward: () => on.forward(),
  };
}
