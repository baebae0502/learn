import { space } from '../design/tokens';

/** The height of a `.section-label` (components/list.css: 24 px). */
export const LABEL_HEIGHT = 24;
/**
 * The 컬렉션 heading inside the virtual list: its label and the gap above it (12, `space[4]`) in one fixed box. The rows are
 * placed absolutely, so a margin between sections would not exist there.
 */
export const HEADING_HEIGHT = space[4] + LABEL_HEIGHT;
