import { describe, expect, it } from 'vitest';
import { createGoogleWebEngine } from './google-web';

// Calls the real service: run by hand with LEARN_TRANSLATION_LIVE=1 to see that the recorded format still holds.
describe.skipIf(process.env['LEARN_TRANSLATION_LIVE'] !== '1')('google-web, live', () => {
  it('translates one English sentence', async () => {
    const engine = createGoogleWebEngine({ fetch: (url, init) => fetch(url, init), isOnline: () => true });
    const out = await engine.translate('Attention is all you need.', { from: 'auto', to: 'ko' }, new AbortController().signal);
    expect(out.detectedFrom).toBe('en');
    expect(out.text.length).toBeGreaterThan(0);
  });
});
