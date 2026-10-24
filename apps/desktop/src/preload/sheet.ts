import { exposeSurface } from './surface';

/** A sheet window (SheetApp): its payload and its answer. It hears nothing: it follows the native theme. */
exposeSurface({ requests: { sheet: ['payload', 'resolve'] }, events: [] });
