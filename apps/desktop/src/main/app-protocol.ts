import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { nowIso } from '@learn/domain';
import { resolveAssetPath } from '@learn/library';
import type { LibraryContext } from './library-context';
import { parseRange } from './range';

export const APP_SCHEME = 'learn';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join('; ');

/** Asset bytes are same-origin with the app; keep any document rendered from them inert (no scripts, opaque origin). */
const ASSET_CSP = "sandbox; default-src 'none'";

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.icc': 'application/octet-stream',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf',
};

/** MIME type for a file served from the renderer bundle. */
export function contentTypeFor(file: string): string {
  return STATIC_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Must run before app 'ready'. corsEnabled is only exercised in dev (renderer on the Vite server). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export function handleAppProtocol(opts: { getContext: () => LibraryContext | null; rendererDir: string; devOrigin: string | null }): void {
  const rendererDir = path.resolve(opts.rendererDir);
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return text(404, 'not found');
    if (url.pathname.startsWith('/asset/')) {
      const cors: Record<string, string> = opts.devOrigin ? { 'Access-Control-Allow-Origin': opts.devOrigin } : {};
      return serveAsset(opts.getContext(), decodeURIComponent(url.pathname.slice('/asset/'.length)), request.headers.get('range'), cors);
    }
    return serveStatic(rendererDir, url.pathname);
  });
}

async function serveAsset(ctx: LibraryContext | null, assetId: string, rangeHeader: string | null, extra: Record<string, string>): Promise<Response> {
  if (!ctx) return text(503, 'library unavailable');
  if (!UUID.test(assetId)) return text(400, 'bad asset id');
  const asset = ctx.repo.getAsset(assetId);
  if (!asset) return text(404, 'unknown asset');
  let file: string;
  try {
    file = resolveAssetPath(ctx.layout, asset);
  } catch {
    return text(403, 'forbidden');
  }
  let size: number;
  try {
    size = (await fs.promises.stat(file)).size;
  } catch {
    ctx.repo.setAvailability(asset.id, 'missing', nowIso());
    return text(404, 'asset file missing');
  }
  const base: Record<string, string> = {
    'Content-Type': asset.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': ASSET_CSP, ...extra,
  };
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  if (size === 0) return new Response(null, { status: 200, headers: { ...base, 'Content-Length': '0' } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  const headers: Record<string, string> = { ...base, 'Content-Length': String(end - start + 1) };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

async function serveStatic(rendererDir: string, pathname: string): Promise<Response> {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.resolve(rendererDir, `.${rel}`);
  if (!file.startsWith(rendererDir + path.sep)) return text(403, 'forbidden');
  try {
    const body = await fs.promises.readFile(file);
    const type = contentTypeFor(file);
    const headers: Record<string, string> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' };
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
    return new Response(body, { headers });
  } catch {
    return text(404, 'not found');
  }
}
