import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGoogleWebEngine, parseGoogleResponse } from './google-web';

const readFixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../../../fixtures/translation/${name}`, import.meta.url), 'utf8'));
const reply = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const signal = () => new AbortController().signal;
const code = (c: string) => expect.objectContaining({ code: c });

describe('parseGoogleResponse (responses recorded 2026-11-03)', () => {
  it('joins the segments and keeps the line ends; the language is the detected one', () => {
    expect(parseGoogleResponse(readFixture('google-en-ko.json'))).toEqual({
      text: '우리는 새롭고 간단한 네트워크 아키텍처를 제안합니다.\n이는 주의 메커니즘에만 기반을 두고 있습니다.',
      detectedFrom: 'en',
    });
    expect(parseGoogleResponse(readFixture('google-auto.json'))).toMatchObject({ detectedFrom: 'en' });
    expect(parseGoogleResponse(readFixture('google-ko.json'))).toEqual({ text: '주의 메커니즘은 중요합니다.', detectedFrom: 'ko' });
  });
  it('refuses what is not that shape', () => {
    for (const bad of [{}, null, 'x', [], [null], [[]].slice(0, 0), [['x']], [[[1]]], [[[]]]]) {
      expect(() => parseGoogleResponse(bad)).toThrow(code('TRANSLATION_BAD_RESPONSE'));
    }
  });
});

describe('the google-web engine', () => {
  const okBody = readFixture('google-en-ko.json');

  it('posts one form-encoded chunk per request to the recorded address', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const engine = createGoogleWebEngine({ fetch: async (url, init) => (seen.push({ url, init }), reply(okBody)), isOnline: () => true });
    expect(engine.id).toBe('google-web');
    const out = await engine.translate('We propose a new simple network architecture.', { from: 'auto', to: 'ko' }, signal());
    expect(out.detectedFrom).toBe('en');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t');
    expect(seen[0]!.init.method).toBe('POST');
    expect(seen[0]!.init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' });
    expect(seen[0]!.init.body).toBe(`q=${encodeURIComponent('We propose a new simple network architecture.')}`);
  });
  it('sends long text as several requests in turn and joins the translations', async () => {
    const bodies: string[] = [];
    const engine = createGoogleWebEngine({
      fetch: async (_u, init) => (bodies.push(String(init.body)), reply([[[`T${bodies.length}`, 'x']], null, bodies.length === 1 ? 'de' : 'en'])),
      isOnline: () => true,
    });
    const text = `${'a'.repeat(4000)}. ${'b'.repeat(4000)}.`;
    const out = await engine.translate(text, { from: 'auto', to: 'ko' }, signal());
    expect(bodies).toHaveLength(2);
    expect(out).toEqual({ text: 'T1 T2', detectedFrom: 'de' });
  });
  it('joins pieces with a space, except for targets written without spaces', async () => {
    const make = () => {
      let n = 0;
      return createGoogleWebEngine({ fetch: async () => reply([[[`T${++n}`, 'x']], null, 'en']), isOnline: () => true });
    };
    const text = `${'a'.repeat(4000)}. ${'b'.repeat(4000)}.`;
    expect((await make().translate(text, { from: 'auto', to: 'de' }, signal())).text).toBe('T1 T2');
    expect((await make().translate(text, { from: 'auto', to: 'ja' }, signal())).text).toBe('T1T2');
    expect((await make().translate(text, { from: 'auto', to: 'zh-CN' }, signal())).text).toBe('T1T2');
  });
  const failing = (fetch: (u: string, i: RequestInit) => Promise<Response>, over: { isOnline?: () => boolean; timeoutMs?: number } = {}) =>
    createGoogleWebEngine({ fetch, isOnline: () => true, ...over });
  it.each([[429, 'TRANSLATION_RATE_LIMITED'], [403, 'TRANSLATION_BLOCKED'], [400, 'TRANSLATION_BLOCKED'], [503, 'TRANSLATION_UNAVAILABLE'], [500, 'TRANSLATION_UNAVAILABLE']])(
    'status %i is %s', async (status, c) => {
      await expect(failing(async () => reply('x', status)).translate('Hi.', { from: 'auto', to: 'ko' }, signal())).rejects.toThrow(code(c));
    },
  );
  it('offline: a throw while the system is offline, or a network-change error', async () => {
    const boom = async () => {
      throw new Error('net::ERR_FAILED');
    };
    await expect(failing(boom, { isOnline: () => false }).translate('Hi.', { from: 'auto', to: 'ko' }, signal())).rejects.toThrow(code('TRANSLATION_OFFLINE'));
    for (const m of ['ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED', 'ERR_NETWORK_CHANGED', 'ERR_ADDRESS_UNREACHABLE']) {
      await expect(failing(async () => { throw new Error(`net::${m}`); }).translate('Hi.', { from: 'auto', to: 'ko' }, signal())).rejects.toThrow(code('TRANSLATION_OFFLINE'));
    }
  });
  it('another throw while online is unavailable', async () => {
    await expect(failing(async () => { throw new Error('net::ERR_FAILED'); }).translate('Hi.', { from: 'auto', to: 'ko' }, signal())).rejects.toThrow(code('TRANSLATION_UNAVAILABLE'));
  });
  it('a request that takes too long is unavailable', async () => {
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_r, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    await expect(failing(hang, { timeoutMs: 20 }).translate('Hi.', { from: 'auto', to: 'ko' }, signal())).rejects.toThrow(code('TRANSLATION_UNAVAILABLE'));
  });
  it('a cancel is CANCELLED, not a failure', async () => {
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_r, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const c = new AbortController();
    const p = failing(hang).translate('Hi.', { from: 'auto', to: 'ko' }, c.signal);
    c.abort();
    await expect(p).rejects.toThrow(code('CANCELLED'));
  });
  it('an answer that is not JSON, or not the shape, is a bad response; nothing is retried', async () => {
    let n = 0;
    const engine = failing(async () => (n++, reply('<html>')));
    await expect(engine.translate('Hi.', { from: 'auto', to: 'ko' }, signal())).rejects.toThrow(code('TRANSLATION_BAD_RESPONSE'));
    expect(n).toBe(1);
    await expect(failing(async () => reply({})).translate('Hi.', { from: 'auto', to: 'ko' }, signal())).rejects.toThrow(code('TRANSLATION_BAD_RESPONSE'));
  });
});
