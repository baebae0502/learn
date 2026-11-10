import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsDataFactory } from './data-factory';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-df-'));
fs.mkdirSync(path.join(root, 'cmaps'));
fs.writeFileSync(path.join(root, 'cmaps', 'a.bcmap'), Buffer.from([1, 2, 3]));
fs.writeFileSync(path.join(root, 'x'), 'secret');
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const factory = new FsDataFactory({ cMapUrl: path.join(root, 'cmaps') + '/', standardFontDataUrl: null });

describe('FsDataFactory', () => {
  it('reads a file of the cmap folder as bytes', async () => {
    const bytes = await factory.fetch({ kind: 'cMapUrl', filename: 'a.bcmap' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([1, 2, 3]);
  });
  it('turns away a path out of the folder, an odd name, a kind without a folder and wasm', async () => {
    await expect(factory.fetch({ kind: 'cMapUrl', filename: '../x' })).rejects.toThrow();
    await expect(factory.fetch({ kind: 'cMapUrl', filename: 'a/b' })).rejects.toThrow();
    await expect(factory.fetch({ kind: 'cMapUrl', filename: '' })).rejects.toThrow();
    await expect(factory.fetch({ kind: 'standardFontDataUrl', filename: 'a.bcmap' })).rejects.toThrow();
    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'a.bcmap' })).rejects.toThrow();
    await expect(factory.fetch({ kind: 'iccUrl', filename: 'a.bcmap' })).rejects.toThrow();
  });
});
