import { exposeSurface } from './surface';

/** A sheet window (SheetApp): its payload, its own actions (the library check, P-17) and its answer. It hears nothing: it follows the native theme. */
exposeSurface({ requests: { sheet: ['payload', 'resolve', 'act'] }, events: [] });
