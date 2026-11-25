import type { SubtitleEncoding } from '@learn/domain';
import { decodeCp949 } from './cp949';

function strict(label: 'utf-8' | 'utf-16le', bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * BOM first; without one, strict UTF-8 then CP949. UTF-16BE is read by swapping bytes so no runtime has to support the
 * `utf-16be` label.
 */
export function decodeSubtitleBytes(bytes: Uint8Array): { text: string; encoding: SubtitleEncoding } | null {
  const done = (text: string | null, encoding: SubtitleEncoding) => (text === null ? null : { text: text.normalize('NFC'), encoding });
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return done(strict('utf-8', bytes.subarray(3)), 'utf-8-bom');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return done(strict('utf-16le', bytes.subarray(2)), 'utf-16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2);
    if (body.length % 2 !== 0) return null;
    const swapped = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i += 2) {
      swapped[i] = body[i + 1]!;
      swapped[i + 1] = body[i]!;
    }
    return done(strict('utf-16le', swapped), 'utf-16be');
  }
  const utf8 = strict('utf-8', bytes);
  if (utf8 !== null) return done(utf8, 'utf-8');
  return done(decodeCp949(bytes), 'cp949');
}
