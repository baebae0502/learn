/** UUID v4. Uses Web Crypto so the same code runs in Node (main) and the renderer. */
export const newId = (): string => globalThis.crypto.randomUUID();

/** UTC ISO-8601; the UI converts to local time for display. */
export const nowIso = (): string => new Date().toISOString();
