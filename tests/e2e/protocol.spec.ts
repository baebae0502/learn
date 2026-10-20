import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test('learn:// protocol serves static pages, ranged assets and rejects bad paths', async ({}, testInfo) => {
  const srcDir = testInfo.outputPath('src');
  fs.mkdirSync(srcDir, { recursive: true });
  const file = `${srcDir}/protocol.pdf`;
  const body = '%PDF-1.4\n% protocol\n%%EOF\n';
  fs.writeFileSync(file, body);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const imported = await page.evaluate((p) => window.learn.importPaths({ paths: [p], mode: 'managed' }), file);
    expect(imported.ok).toBe(true);
    const outcome = imported.ok ? imported.data[0] : undefined;
    expect(outcome?.status).toBe('imported');
    const assetId = outcome?.status === 'imported' ? outcome.item.assetId : '';
    expect(assetId).not.toBe('');

    const probe = (url: string, range?: string) =>
      page.evaluate(
        async ({ url, range }) => {
          const r = await fetch(url, range ? { headers: { Range: range } } : undefined);
          const text = await r.text();
          return {
            status: r.status,
            csp: r.headers.get('content-security-policy'),
            contentRange: r.headers.get('content-range'),
            length: r.headers.get('content-length'),
            text,
          };
        },
        { url, range },
      );

    const html = await probe('learn://app/index.html');
    expect(html.status).toBe(200);
    expect(html.csp).toContain("'wasm-unsafe-eval'");

    const scriptSrc = await page.evaluate(() => document.querySelector('script[src]')?.getAttribute('src') ?? '');
    expect(scriptSrc).not.toBe('');
    const js = await probe(new URL(scriptSrc, 'learn://app/index.html').href);
    expect(js.status).toBe(200);
    expect(js.csp).toBeNull();

    for (const bad of ['learn://app/%2e%2e/%2e%2e/package.json', 'learn://app/..%2f..%2fpackage.json']) {
      expect((await probe(bad)).status).not.toBe(200);
    }

    expect((await probe('learn://app/asset/not-a-uuid')).status).toBe(400);
    const unknown = await page.evaluate(() => crypto.randomUUID());
    expect((await probe(`learn://app/asset/${unknown}`)).status).toBe(404);

    const assetUrl = `learn://app/asset/${assetId}`;
    const size = Buffer.byteLength(body);
    const part = await probe(assetUrl, 'bytes=0-3');
    expect(part.status).toBe(206);
    expect(part.contentRange).toBe(`bytes 0-3/${size}`);
    expect(part.text).toBe('%PDF');
    expect(part.csp).toBe("sandbox; default-src 'none'");

    const unsat = await probe(assetUrl, 'bytes=999999-');
    expect(unsat.status).toBe(416);
    expect(unsat.contentRange).toBe(`bytes */${size}`);

    const full = await probe(assetUrl);
    expect(full.status).toBe(200);
    expect(full.length).toBe(String(size));
    expect(full.text).toBe(body);
  } finally {
    await app.close();
  }
});
