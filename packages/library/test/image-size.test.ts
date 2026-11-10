import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_MIMES, sniffImage } from '../src/sniff';
import { imageSize } from '../src/image-size';
import { avif, bytes, ftyp, gif, irot, ispe, jpeg, png, u16be, u32be, u32le, webpExtended, webpLossless, webpLossy } from './image-bytes';

describe('sniffImage (spec 3.1)', () => {
  it('knows the five by their first bytes', () => {
    expect(sniffImage(png(1, 1))).toBe('image/png');
    expect(sniffImage(jpeg(1, 1))).toBe('image/jpeg');
    expect(sniffImage(gif(1, 1, '87a'))).toBe('image/gif');
    for (const w of [webpLossy(1, 1), webpLossless(1, 1), webpExtended(1, 1)]) expect(sniffImage(w)).toBe('image/webp');
    expect(sniffImage(ftyp('avif', 'mif1', 'miaf'))).toBe('image/avif');
    expect(sniffImage(ftyp('avis', 'msf1'))).toBe('image/avif');
    expect(sniffImage(ftyp('mif1', 'avif', 'miaf'))).toBe('image/avif');
  });
  it('turns HEIC away even when it lists avif (J1), an unknown WebP chunk and a video', () => {
    expect(sniffImage(ftyp('heic', 'mif1', 'heic'))).toBeNull();
    expect(sniffImage(ftyp('mif1', 'heic', 'miaf'))).toBeNull();
    expect(sniffImage(ftyp('mif1', 'avif', 'hevc'))).toBeNull();
    expect(sniffImage(bytes('RIFF', u32le(4), 'WEBP', 'ALPH'))).toBeNull();
    expect(sniffImage(ftyp('isom', 'mp42'))).toBeNull();
    expect(sniffImage(ftyp('isom', 'avif'))).toBeNull();
    expect(sniffImage(bytes('%PDF-1.7'))).toBeNull();
  });
});

describe('imageSize (spec 3.2)', () => {
  it('reads PNG, GIF87a/89a and the three WebP forms', () => {
    expect(imageSize(png(4032, 3024), 'image/png')).toEqual({ width: 4032, height: 3024 });
    expect(imageSize(gif(24, 16, '87a'), 'image/gif')).toEqual({ width: 24, height: 16 });
    expect(imageSize(gif(24, 16), 'image/gif')).toEqual({ width: 24, height: 16 });
    expect(imageSize(webpLossy(640, 480), 'image/webp')).toEqual({ width: 640, height: 480 });
    expect(imageSize(webpLossless(48, 32), 'image/webp')).toEqual({ width: 48, height: 32 });
    expect(imageSize(webpExtended(5000, 3000), 'image/webp')).toEqual({ width: 5000, height: 3000 });
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('JPEG orientation %i, little and big endian: 5–8 swap the sides', (o) => {
    const want = o >= 5 ? { width: 40, height: 60 } : { width: 60, height: 40 };
    expect(imageSize(jpeg(60, 40, { orientation: o, order: 'II' }), 'image/jpeg')).toEqual(want);
    expect(imageSize(jpeg(60, 40, { orientation: o, order: 'MM' }), 'image/jpeg')).toEqual(want);
  });
  it('walks APP segments and fill bytes before the SOF, and stops at SOS', () => {
    expect(imageSize(jpeg(800, 600, { app0: true, orientation: 6, fill: true }), 'image/jpeg')).toEqual({ width: 600, height: 800 });
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xda], u16be(8), [1, 1, 0, 0, 63, 0]), 'image/jpeg')).toBeNull();
  });
  it('AVIF follows pitm and ipma: a thumbnail ispe listed first does not win, irot 1 or 3 swaps, u16 indexes and the essential bit', () => {
    const props = [ispe(160, 120), ispe(4032, 3024), irot(1)];
    expect(imageSize(avif({ primary: 1, items: [{ id: 2, props: [1] }, { id: 1, props: [2] }], props }), 'image/avif')).toEqual({ width: 4032, height: 3024 });
    expect(imageSize(avif({ primary: 1, items: [{ id: 1, props: [2, 0x83] }], props }), 'image/avif')).toEqual({ width: 3024, height: 4032 });
    expect(imageSize(avif({ primary: 1, items: [{ id: 1, props: [2, 3] }], props, ipmaFlags: 1 }), 'image/avif')).toEqual({ width: 3024, height: 4032 });
  });
  it('is null and never throws on a cut head, a false length, a box of size 0 or 1, and a side outside 1–1,000,000', () => {
    const full = jpeg(60, 40, { orientation: 6 });
    for (let n = 0; n < full.length; n++) expect(() => imageSize(full.subarray(0, n), 'image/jpeg')).not.toThrow();
    expect(imageSize(png(4032, 3024).subarray(0, 20), 'image/png')).toBeNull();
    const lying = jpeg(60, 40);
    lying[4] = 0xff; // the SOF's length now runs past the buffer
    expect(imageSize(lying, 'image/jpeg')).toBeNull();
    expect(imageSize(bytes(ftyp('avif', 'mif1'), u32be(0), 'meta'), 'image/avif')).toBeNull();
    expect(imageSize(bytes(ftyp('avif', 'mif1'), u32be(1), 'meta', u32be(0), u32be(64)), 'image/avif')).toBeNull();
    expect(imageSize(png(0, 10), 'image/png')).toBeNull();
    expect(imageSize(webpExtended(1_000_001, 10), 'image/webp')).toBeNull();
    for (const mime of IMAGE_MIMES) for (let n = 0; n < 64; n++) expect(() => imageSize(new Uint8Array(n).fill(0xff), mime)).not.toThrow();
  });
  it('reads the committed images', () => {
    const at = (name: string) => new Uint8Array(fs.readFileSync(path.resolve(import.meta.dirname, '../../../fixtures/static/images', name)));
    expect(imageSize(at('transparent.png'), 'image/png')).toEqual({ width: 64, height: 48 });
    expect(imageSize(at('orient6.jpg'), 'image/jpeg')).toEqual({ width: 40, height: 60 });
    expect(imageSize(at('alpha.webp'), 'image/webp')).toEqual({ width: 48, height: 32 });
    expect(imageSize(at('two-frames.gif'), 'image/gif')).toEqual({ width: 24, height: 16 });
    expect(imageSize(at('still.avif'), 'image/avif')).toEqual({ width: 40, height: 30 });
    for (const [name, mime] of [['transparent.png', 'image/png'], ['orient6.jpg', 'image/jpeg'], ['alpha.webp', 'image/webp'], ['two-frames.gif', 'image/gif'], ['still.avif', 'image/avif']] as const) expect(sniffImage(at(name))).toBe(mime);
  });
});
