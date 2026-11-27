import { CP949_TABLE_B64 } from './cp949-table';

const LEAD_MIN = 0x81;
const LEAD_MAX = 0xfe;
const TRAIL_MIN = 0x41;
const TRAIL_MAX = 0xfe;
const TRAILS = TRAIL_MAX - TRAIL_MIN + 1;

let table: Uint16Array | null = null;
function cells(): Uint16Array {
  if (table === null) {
    const raw = Buffer.from(CP949_TABLE_B64, 'base64');
    // Copy so the view starts on an aligned buffer, not inside Node's shared pool.
    table = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  }
  return table;
}

/**
 * The WHATWG euc-kr decoder (fatal) over a committed table: Node's own euc-kr label is strict EUC-KR on some
 * versions, which would reject the extended syllables a Windows CP949 file uses.
 */
export function decodeCp949(bytes: Uint8Array): string | null {
  const t = cells();
  const out = new Uint16Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out[n++] = b;
      continue;
    }
    if (b < LEAD_MIN || b > LEAD_MAX) return null;
    const trail = bytes[++i];
    if (trail === undefined || trail < TRAIL_MIN || trail > TRAIL_MAX) return null;
    const cp = t[(b - LEAD_MIN) * TRAILS + (trail - TRAIL_MIN)]!;
    if (cp === 0) return null;
    out[n++] = cp;
  }
  const parts: string[] = [];
  // Chunked so the argument list stays small.
  for (let k = 0; k < n; k += 8192) parts.push(String.fromCharCode(...out.subarray(k, Math.min(n, k + 8192))));
  return parts.join('');
}
