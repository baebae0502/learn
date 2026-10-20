import { z } from 'zod';

/** Coordinate rules are part of schema v1 — see docs/decisions/0002-anchor-coordinates.md. */
export const ANCHOR_SCHEMA_VERSION = 1;

const quote = z.object({ exact: z.string().min(1), prefix: z.string(), suffix: z.string() });
const quad = z.array(z.number()).length(8);
const unit = z.number().min(0).max(1);

export const pdfAnchor = z.object({
  kind: z.literal('pdf'),
  revisionId: z.uuid(),
  pageIndex: z.number().int().min(0),
  quads: z.array(quad).min(1),
  coordinateSpace: z.literal('pdf-user-space'),
  quote: quote.optional(),
});

export const videoAnchor = z
  .object({
    kind: z.literal('video'),
    revisionId: z.uuid(),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    frame: z.object({ atMs: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
    /** [x, y, w, h] normalized to the decoded frame, letterbox excluded. */
    rect: z.tuple([unit, unit, unit, unit]).optional(),
  })
  .refine((a) => a.endMs >= a.startMs, { message: 'endMs must be >= startMs' })
  .refine((a) => !a.rect || (a.rect[0] + a.rect[2] <= 1 && a.rect[1] + a.rect[3] <= 1), { message: 'rect must stay inside the frame' });

export const epubAnchor = z.object({
  kind: z.literal('epub'),
  revisionId: z.uuid(),
  spineHref: z.string().min(1),
  cfi: z.string().startsWith('epubcfi('),
  quote,
});

export const webAnchor = z.object({
  kind: z.literal('web'),
  revisionId: z.uuid(),
  textPosition: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }),
  quote,
});

export const slideAnchor = z.object({
  kind: z.literal('slide'),
  revisionId: z.uuid(),
  derivedRevisionId: z.uuid(),
  slideIndex: z.number().int().min(0),
  quads: z.array(quad),
});

export const sourceAnchor = z.union([pdfAnchor, videoAnchor, epubAnchor, webAnchor, slideAnchor]);
export type SourceAnchor = z.infer<typeof sourceAnchor>;
