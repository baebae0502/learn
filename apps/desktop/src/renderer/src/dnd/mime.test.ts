import { describe, expect, it } from 'vitest';
import { MIME_COLLECTION, MIME_ITEMS, MIME_TAG, collectionDrag, itemsDrag, parseCollectionPayload, parseItemsPayload, parseTagPayload, tagDrag } from './mime';

describe('the three payloads of an in-app drag (spec 8.1)', () => {
  it('names the types as the spec does', () => {
    expect([MIME_ITEMS, MIME_COLLECTION, MIME_TAG]).toEqual(['application/x-learn-items+json', 'application/x-learn-collection+json', 'application/x-learn-tag+json']);
  });

  it('items go by id in table order, with a plain-text form for other apps', () => {
    const drag = itemsDrag(['b', 'a', 'c']);
    expect(JSON.parse(drag[MIME_ITEMS]!)).toEqual({ itemIds: ['b', 'a', 'c'] });
    expect(drag['text/plain']).toBe('자료 3개');
    expect(parseItemsPayload(drag[MIME_ITEMS]!)).toEqual(['b', 'a', 'c']);
  });

  it('a collection and a tag go by id and are named in plain text', () => {
    const c = collectionDrag({ id: 'c1', name: '분자생물학' });
    expect(JSON.parse(c[MIME_COLLECTION]!)).toEqual({ collectionId: 'c1' });
    expect(c['text/plain']).toBe('분자생물학');
    expect(parseCollectionPayload(c[MIME_COLLECTION]!)).toBe('c1');
    const tag = tagDrag({ id: 't1', name: '시험' });
    expect(JSON.parse(tag[MIME_TAG]!)).toEqual({ tagId: 't1' });
    expect(tag['text/plain']).toBe('시험');
    expect(parseTagPayload(tag[MIME_TAG]!)).toBe('t1');
  });

  it('keeps the first of a repeated id', () => {
    expect(parseItemsPayload('{"itemIds":["a","b","a"]}')).toEqual(['a', 'b']);
  });

  it('refuses what is not ours: not JSON, the wrong shape, no ids, an id that is not text, too many ids', () => {
    for (const bad of ['', 'x', '[]', 'null', '{}', '{"itemIds":[]}', '{"itemIds":"a"}', '{"itemIds":[1]}', '{"itemIds":[""]}']) expect(parseItemsPayload(bad), bad).toBeNull();
    expect(parseItemsPayload(JSON.stringify({ itemIds: Array.from({ length: 100_001 }, (_, i) => `i${i}`) }))).toBeNull();
    for (const bad of ['', '{}', '{"collectionId":3}', '{"collectionId":""}', '{"tagId":"t"}']) expect(parseCollectionPayload(bad), bad).toBeNull();
    for (const bad of ['', '{}', '{"tagId":3}', '{"tagId":""}', '{"collectionId":"c"}']) expect(parseTagPayload(bad), bad).toBeNull();
  });
});
