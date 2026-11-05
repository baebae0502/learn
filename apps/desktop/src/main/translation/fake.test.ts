import { describe, expect, it } from 'vitest';
import { createFakeEngine } from './fake';

const run = (e: ReturnType<typeof createFakeEngine>, text: string, from: 'auto' | 'en' = 'auto') => e.translate(text, { from, to: 'ko' }, new AbortController().signal);

describe('the fake engine', () => {
  it('translates the known sentences from its table and marks others', async () => {
    const e = createFakeEngine();
    expect(e.id).toBe('fake');
    expect(await run(e, 'Attention is all you need.')).toEqual({ text: '주의가 필요한 전부입니다.', detectedFrom: 'en' });
    expect((await run(e, 'It is based solely on attention mechanisms. Something else.')).text).toBe('이는 주의 메커니즘에만 기반을 두고 있습니다. 번역: Something else.');
    expect(e.calls()).toBe(2);
  });
  it('fails the way each mode says', async () => {
    const e = createFakeEngine();
    for (const [mode, code] of [['offline', 'TRANSLATION_OFFLINE'], ['rateLimited', 'TRANSLATION_RATE_LIMITED'], ['blocked', 'TRANSLATION_BLOCKED'], ['unavailable', 'TRANSLATION_UNAVAILABLE'], ['badResponse', 'TRANSLATION_BAD_RESPONSE']] as const) {
      e.setMode(mode);
      await expect(run(e, 'Hi.')).rejects.toMatchObject({ code });
    }
    e.setMode('ok');
    await expect(run(e, 'Hi.')).resolves.toBeDefined();
    expect(e.calls()).toBe(6);
  });
  it('slow answers after 1.5 s and stops at once when cancelled', async () => {
    const e = createFakeEngine();
    e.setMode('slow');
    const c = new AbortController();
    const started = Date.now();
    const p = e.translate('Hi.', { from: 'auto', to: 'ko' }, c.signal);
    c.abort();
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(500);
  });
});
