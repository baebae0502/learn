// M7c images: the five raster formats import by their first bytes (a wrong extension does not matter) and the pixel size
// is stored with the asset.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, importPaths, launch } from './helpers';

test('five raster formats import by their header — a PNG named .jpg too — with their pixel size', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const names = ['transparent.png', 'orient6.jpg', 'alpha.webp', 'two-frames.gif', 'still.avif', 'png-named.jpg'];
    // png-named.jpg has the bytes of transparent.png: it comes in as a second item on purpose.
    const items = await importPaths(page, names.map((n) => path.join(FIXTURES, n)), { allowDuplicate: true });
    const byName = new Map(items.map((i) => [i.originalName, i]));
    const expected = [
      ['transparent.png', 'image/png', { width: 64, height: 48 }],
      ['orient6.jpg', 'image/jpeg', { width: 40, height: 60 }], // EXIF orientation 6 swaps the stored 60×40
      ['alpha.webp', 'image/webp', { width: 48, height: 32 }],
      ['two-frames.gif', 'image/gif', { width: 24, height: 16 }],
      ['still.avif', 'image/avif', { width: 40, height: 30 }],
      ['png-named.jpg', 'image/png', { width: 64, height: 48 }],
    ] as const;
    for (const [name, mime, imageSize] of expected) expect(byName.get(name), name).toMatchObject({ type: 'image', mime, imageSize });
  } finally {
    await app.close();
  }
});
