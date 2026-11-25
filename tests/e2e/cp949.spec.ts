import { expect, test } from '@playwright/test';
import { launch } from './helpers';
import { CP949_TABLE_B64 } from '../../packages/library/src/subtitles/cp949-table';

// The committed table stands in for Electron's euc-kr decoder (WHATWG index-euc-kr); this checks it against the real one.
test('the committed CP949 table equals the euc-kr decoder of the Electron main process', async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const fromElectron = await app.evaluate(() => {
      const decoder = new TextDecoder('euc-kr', { fatal: true });
      const cells: number[] = [];
      for (let lead = 0x81; lead <= 0xfe; lead++) {
        for (let trail = 0x41; trail <= 0xfe; trail++) {
          try {
            const s = decoder.decode(Uint8Array.of(lead, trail));
            cells.push(s.length === 1 ? s.charCodeAt(0) : 0);
          } catch {
            cells.push(0);
          }
        }
      }
      return cells;
    });
    const raw = Buffer.from(CP949_TABLE_B64, 'base64');
    const committed = Array.from({ length: raw.length / 2 }, (_, i) => raw.readUInt16LE(i * 2));
    // Positive control: the sizes first, so an empty or truncated pair cannot agree by being equally empty.
    expect(fromElectron.length).toBe(23_940);
    expect(committed.length).toBe(23_940);
    expect(fromElectron.filter((v) => v !== 0).length).toBe(17_048);
    expect(committed.filter((v) => v !== 0).length).toBe(17_048);
    const differing = committed.flatMap((v, i) => (v === fromElectron[i] ? [] : [i]));
    expect(differing).toEqual([]);
  } finally {
    await app.close();
  }
});
