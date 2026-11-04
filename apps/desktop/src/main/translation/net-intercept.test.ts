import { readFileSync } from 'node:fs';
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
  it('answers two sentences as recorded: a blank after every segment but the last, so they join as "K3 K4" (re-review N-5)', async () => {
    const net = createTranslationNetIntercept();
    const res = await net.handle(post('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t', `q=${encodeURIComponent('We propose a new simple network architecture. It is based solely on attention mechanisms.')}`));
    const body = (await res.json()) as unknown[][][];
    expect(body[0]!.map((seg) => seg[0])).toEqual(['우리는 새롭고 간단한 네트워크 아키텍처를 제안합니다. ', '이는 주의 메커니즘에만 기반을 두고 있습니다.']);
    expect(parseGoogleResponse(body).text).toBe('우리는 새롭고 간단한 네트워크 아키텍처를 제안합니다. 이는 주의 메커니즘에만 기반을 두고 있습니다.');
    const fixture = JSON.parse(readFileSync(new URL('../../../../../fixtures/translation/google-auto.json', import.meta.url), 'utf8')) as unknown[][][];
    expect(body[0]![0]!.length).toBe(fixture[0]![0]!.length);
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
