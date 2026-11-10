export const bytes = (...parts: Array<readonly number[] | string | Uint8Array>): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p));
  return Uint8Array.from(out);
};
export const u16be = (n: number) => [n >> 8, n & 255];
export const u16le = (n: number) => [n & 255, n >> 8];
export const u24le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
export const u32be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
export const u32le = (n: number) => u32be(n).reverse();
export const box = (type: string, ...body: Array<readonly number[] | string | Uint8Array>) => { const b = bytes(...body); return bytes(u32be(8 + b.length), type, b); };
export const fullBox = (type: string, version: number, flags: number, ...body: Array<readonly number[] | string | Uint8Array>) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...body);
export const png = (w: number, h: number) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR', u32be(w), u32be(h), [8, 6, 0, 0, 0]);
export const gif = (w: number, h: number, v: '87a' | '89a' = '89a') => bytes(`GIF${v}`, u16le(w), u16le(h), [0, 0, 0]);
export const webpLossy = (w: number, h: number) => bytes('RIFF', u32le(22), 'WEBP', 'VP8 ', u32le(10), [0, 0, 0], [0x9d, 0x01, 0x2a], u16le(w), u16le(h));
export const webpLossless = (w: number, h: number) => bytes('RIFF', u32le(17), 'WEBP', 'VP8L', u32le(5), [0x2f], u32le((w - 1) | ((h - 1) << 14)));
export const webpExtended = (w: number, h: number) => bytes('RIFF', u32le(22), 'WEBP', 'VP8X', u32le(10), [0x10, 0, 0, 0], u24le(w - 1), u24le(h - 1));
const exif = (orientation: number, order: 'II' | 'MM') => {
  const s16 = order === 'II' ? u16le : u16be;
  const s32 = order === 'II' ? u32le : u32be;
  const tiff = bytes(order, s16(42), s32(8), s16(1), s16(0x0112), s16(3), s32(1), s16(orientation), [0, 0], s32(0));
  return bytes([0xff, 0xe1], u16be(2 + 6 + tiff.length), 'Exif\0\0', tiff);
};
export const jpeg = (w: number, h: number, o: { orientation?: number; order?: 'II' | 'MM'; app0?: boolean; fill?: boolean } = {}) => bytes(
  [0xff, 0xd8],
  o.app0 ? bytes([0xff, 0xe0], u16be(16), 'JFIF\0', [1, 1, 0], u16be(1), u16be(1), [0, 0]) : [],
  o.orientation ? exif(o.orientation, o.order ?? 'II') : [],
  o.fill ? [0xff] : [],
  [0xff, 0xc0], u16be(17), [8], u16be(h), u16be(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  [0xff, 0xda], u16be(8), [1, 1, 0, 0, 63, 0],
);
export const ftyp = (major: string, ...compatible: string[]) => box('ftyp', major, u32be(0), ...compatible);
export const ispe = (w: number, h: number) => fullBox('ispe', 0, 0, u32be(w), u32be(h));
export const irot = (angle: number) => box('irot', [angle]);
export const avif = (o: { primary: number; items: Array<{ id: number; props: number[] }>; props: Uint8Array[]; ipmaFlags?: number; brands?: [string, ...string[]] }) => {
  const wide = ((o.ipmaFlags ?? 0) & 1) === 1;
  return bytes(
    ftyp(...(o.brands ?? ['avif', 'mif1', 'avif'])),
    fullBox('meta', 0, 0,
      fullBox('hdlr', 0, 0, u32be(0), 'pict', u32be(0), u32be(0), u32be(0), [0]),
      fullBox('pitm', 0, 0, u16be(o.primary)),
      box('iprp',
        box('ipco', ...o.props),
        fullBox('ipma', 0, o.ipmaFlags ?? 0, u32be(o.items.length),
          ...o.items.map((it) => bytes(u16be(it.id), [it.props.length], ...it.props.map((p) => (wide ? u16be(p) : [p])))))),
    ),
  );
};
