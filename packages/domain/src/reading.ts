import { z } from 'zod';

export const readingLocatorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pdf'),
    pageIndex: z.number().int().min(0),
    scale: z.number().positive().optional(),
    top: z.number().optional(),
    left: z.number().optional(),
    zoom: z.union([z.enum(['auto', 'page-width', 'page-fit']), z.number().min(0.25).max(4)]).optional(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  }),
  z.object({ kind: z.literal('video'), timeMs: z.number().int().min(0) }),
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
