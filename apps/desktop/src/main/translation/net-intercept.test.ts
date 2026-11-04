import { describe, expect, it } from 'vitest';
import { createTranslationNetIntercept } from './net-intercept';
import { parseGoogleResponse } from './google-web';

const post = (url: string, body: string) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });

describe('the E2E translation host', () => {
  it('answers the translation host in the recorded format and records what it was sent', async () => {
    const net = createTranslationNetIntercept();
    const res = await net.handle(post('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t', `q=${encodeURIComponent('Attention is all you need.')}`));
    expect(res.status).toBe(200);
    expect(parseGoogleResponse(await res.json())).toEqual({ text: '주의가 필요한 전부입니다.', detectedFrom: 'en' });
    expect(net.requests()).toEqual([
      expect.objectContaining({ method: 'POST', host: 'translate.googleapis.com', path: '/translate_a/single', search: '?client=gtx&sl=auto&tl=ko&dt=t', body: 'q=Attention%20is%20all%20you%20need.' }),
    ]);
  });
  it('refuses every other https request and answers it with nothing', async () => {
    const net = createTranslationNetIntercept();
    for (const url of ['https://example.org/', 'https://translate.googleapis.com/other', 'https://translate.googleapis.com.evil.org/translate_a/single']) {
      expect((await net.handle(new Request(url))).status).toBe(403);
    }
    expect(net.requests()).toHaveLength(0);
    expect(net.refused()).toEqual(['example.org', 'translate.googleapis.com', 'translate.googleapis.com.evil.org']);
  });
});
