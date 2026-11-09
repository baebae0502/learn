import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../viewers/pdfjs', () => ({ pdfjs: vi.fn(), pdfSource: vi.fn() }));
const { startProbe } = await import('./fileFacts');

afterEach(() => vi.unstubAllGlobals());

describe('startProbe', () => {
  it('does not open an image as a video: nothing is probed, its facts are none', async () => {
    const probes: Array<{ kind: 'pdf' | 'video'; assetId: string }> = [];
    vi.stubGlobal('window', { __learnProbes: probes });
    const create = vi.fn();
    vi.stubGlobal('document', { createElement: create });
    const probe = startProbe({ type: 'image', assetId: 'a1' });
    await expect(probe.done).resolves.toEqual({});
    expect(probes).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});
