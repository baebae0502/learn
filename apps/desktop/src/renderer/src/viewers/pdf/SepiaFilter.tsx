import { useMemo } from 'react';

/** The id the page canvases' and the thumbnails' CSS point at (pdf-viewer.css, sidebar.css). */
export const SEPIA_FILTER_ID = 'learn-page-sepia';

/** `--page-sepia-bg` as sRGB channels in 0–1, read from the token once (a canvas converts the oklch value). */
function paperChannels(): [number, number, number] {
  const probe = document.createElement('div');
  probe.style.background = 'var(--page-sepia-bg)';
  document.body.append(probe);
  const css = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0]! / 255, d[1]! / 255, d[2]! / 255];
}

/**
 * 세피아 multiplies the drawn page with the paper colour: each channel of the canvas times the token's. As a filter on each canvas
 * (a diagonal colour matrix, in sRGB like the blend it stands for) rather than a blend, so the opaque detail canvas pdf.js lays over a
 * capped page still covers the low-resolution one under it instead of both being multiplied into the paper.
 */
export function SepiaFilter() {
  const [r, g, b] = useMemo(paperChannels, []);
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <filter id={SEPIA_FILTER_ID} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values={`${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`} />
      </filter>
    </svg>
  );
}
