import { mainStrings } from '../strings';
import { isMostlyHangul, splitSentences } from './prepare';

/**
 * E2E only (index.ts, LEARN_TRANSLATION_NET=intercept under LEARN_E2E=1): the real google-web engine and the real remoteFetch
 * (net.fetch) run, and only the network end is a test's. A handler on the default session's https answers the translation
 * host with a canned body in the recorded format (fixtures/translation, google-web.test.ts); every other https request is
 * refused here and recorded, so nothing reaches a real host.
 */

export interface RecordedRequest {
  method: string;
  host: string;
  path: string;
  search: string;
  contentType: string | null;
  /** The POST body as sent: `q=` and the percent-encoded text. */
  body: string;
}

const TRANSLATION_HOST = 'translate.googleapis.com';
const TRANSLATION_PATH = '/translate_a/single';
const CANNED = new Map<string, string>(mainStrings.fakeTranslation.pairs);

/** The recorded answer shape: [[[translated, original, null, null, 3], ...], null, detectedLanguage, ...]. */
export function cannedGoogleBody(text: string): unknown {
  const sentences = splitSentences(text);
  // As recorded (fixtures/translation/google-auto.json): every segment but the last keeps the blank that followed its sentence.
  const segments = sentences.map((s, i) => {
    const gap = i < sentences.length - 1 ? ' ' : '';
    return [`${CANNED.get(s) ?? `${mainStrings.fakeTranslation.unknownPrefix}${s}`}${gap}`, `${s}${gap}`, null, null, 3, null, null, [[]], [[['', 'en_ko_2023q1.md']]]];
  });
  return [segments, null, isMostlyHangul(text) ? 'ko' : 'en', null, null, null, null, []];
}

export interface TranslationNetIntercept {
  /** The https handler for `session.defaultSession.protocol.handle('https', …)`. */
  handle(request: Request): Promise<Response>;
  /** Requests the translation host has taken since launch. */
  requests(): readonly RecordedRequest[];
  /** Every other https request, refused. */
  refused(): readonly string[];
}

export function createTranslationNetIntercept(): TranslationNetIntercept {
  const seen: RecordedRequest[] = [];
  const refused: string[] = [];
  return {
    async handle(request) {
      const url = new URL(request.url);
      if (url.hostname !== TRANSLATION_HOST || url.pathname !== TRANSLATION_PATH) {
        refused.push(url.host);
        return new Response('refused', { status: 403 });
      }
      const body = await request.text();
      seen.push({
        method: request.method,
        host: url.host,
        path: url.pathname,
        search: url.search,
        contentType: request.headers.get('content-type'),
        body,
      });
      const q = new URLSearchParams(body).get('q') ?? '';
      return new Response(JSON.stringify(cannedGoogleBody(q)), { status: 200, headers: { 'content-type': 'application/json; charset=UTF-8' } });
    },
    requests: () => seen,
    refused: () => refused,
  };
}
