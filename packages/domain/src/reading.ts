import { z } from 'zod';

/** The reader's scroll modes and spread modes (pdf.js ScrollMode VERTICAL / HORIZONTAL / PAGE, SpreadMode NONE / ODD / EVEN). */
export const SCROLL_MODES = ['vertical', 'horizontal', 'page'] as const;
export type ScrollModeName = (typeof SCROLL_MODES)[number];
export const SPREAD_MODES = ['none', 'odd', 'even'] as const;
export type SpreadModeName = (typeof SPREAD_MODES)[number];

export const readingLocatorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pdf'),
    pageIndex: z.number().int().min(0),
    scale: z.number().positive().optional(),
    top: z.number().optional(),
    left: z.number().optional(),
    zoom: z.union([z.enum(['auto', 'page-width', 'page-fit']), z.number().min(0.25).max(4)]).optional(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    /** How the pages flow and whether they pair up; absent is vertical and none (what a value saved before the modes means). */
    scroll: z.enum(SCROLL_MODES).optional(),
    spread: z.enum(SPREAD_MODES).optional(),
    /** The document's page count when this was saved: what a reading of the item (progress, the panel) can say without opening it. */
    pages: z.number().int().min(1).optional(),
  }),
  z.object({ kind: z.literal('video'), timeMs: z.number().int().min(0) }),
  z.object({
    kind: z.literal('image'),
    /** Absent is 'fit'. */
    zoom: z.union([z.enum(['fit', 'width']), z.number().min(0.05).max(8)]).optional(),
    /** The image point at the stage's centre, in 0-1 of the unrotated image (EXIF orientation applied); absent is 0.5. */
    cx: z.number().min(0).max(1).optional(),
    cy: z.number().min(0).max(1).optional(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  }),
]);
/** A saved position reaches the library list at most this often per item (the last one of a burst at its end). */
export const POSITION_NOTICE_MS = 2000;

export type ReadingLocator = z.infer<typeof readingLocatorSchema>;

export interface ReadingPosition {
  itemId: string;
  revisionId: string;
  locator: ReadingLocator;
  progress: number | null;
  openedAt: string | null;
  updatedAt: string;
}
