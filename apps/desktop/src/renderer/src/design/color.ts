/**
 * Minimal colour math for the design tokens: OKLCH → sRGB, alpha compositing and
 * WCAG 2.x contrast. No imports so that `scripts/build-tokens.mjs` can load it with
 * Node's TypeScript type stripping as well as through Vite/Vitest.
 *
 * Matrices: Björn Ottosson, "A perceptual color space for image processing" (2020).
 */

export interface Rgba {
  /** Gamma-encoded sRGB channels in 0..1 (clamped). */
  r: number;
  g: number;
  b: number;
  a: number;
  /** True when the OKLCH input fell outside the sRGB gamut and was clamped. */
  clamped: boolean;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/;
const HEX_RE = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

function encode(linear: number): number {
  return linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

function decode(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function oklchToRgba(l: number, c: number, hDeg: number, alpha = 1): Rgba {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  const eps = 1e-4;
  const clamped = lin.some((v) => v < -eps || v > 1 + eps);
  const [r, g, bl] = lin.map((v) => Math.min(1, Math.max(0, encode(Math.min(1, Math.max(0, v))))));
  return { r: r!, g: g!, b: bl!, a: alpha, clamped };
}

/** Parse `oklch(L% C H [/ A])`, `oklch(L C H)` or `#rrggbb[aa]`. */
export function parseColor(input: string): Rgba {
  const s = input.trim();
  const ok = OKLCH_RE.exec(s);
  if (ok) {
    const l = Number(ok[1]) / (ok[2] === '%' ? 100 : 1);
    const alphaRaw = ok[5] === undefined ? 1 : Number(ok[5]) / (ok[6] === '%' ? 100 : 1);
    return oklchToRgba(l, Number(ok[3]), Number(ok[4]), alphaRaw);
  }
  const hex = HEX_RE.exec(s);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    const a = hex[2] === undefined ? 1 : parseInt(hex[2], 16) / 255;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a, clamped: false };
  }
  throw new Error(`Unsupported colour: ${input}`);
}

/** Source-over composite of `top` onto an opaque `bottom` (in gamma-encoded sRGB, like browsers). */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
    clamped: top.clamped || bottom.clamped,
  };
}

export function toHex(c: Rgba): string {
  const h = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a) : ''}`;
}

export function relativeLuminance(c: Rgba): number {
  return 0.2126 * decode(c.r) + 0.7152 * decode(c.g) + 0.0722 * decode(c.b);
}

/** WCAG 2.x contrast ratio. Translucent foregrounds are composited onto the background first. */
export function contrast(fg: Rgba, bg: Rgba): number {
  const base = bg.a < 1 ? composite(bg, { r: 1, g: 1, b: 1, a: 1, clamped: false }) : bg;
  const top = fg.a < 1 ? composite(fg, base) : fg;
  const l1 = relativeLuminance(top);
  const l2 = relativeLuminance(base);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
