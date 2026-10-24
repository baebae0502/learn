import { describe, expect, it } from 'vitest';
import type { ItemMetadata } from '@learn/domain';
import { draftOf, sameInfo, validateInfo, type InfoDraft } from './editInfo';

let n = 0;
const key = () => `k${++n}`;
const META: ItemMetadata = { creators: [{ name: '한서진', role: 'author' }, { name: '윤재하', role: 'editor' }], date: '2024-03', publisher: '학습출판' };
const base = (): InfoDraft => draftOf('세포 신호 전달', META, key);

describe('정보 편집: the draft, its checks, and what counts as a change (spec §5.3)', () => {
  it('starts from the stored values, an empty field as empty text', () => {
    const d = base();
    expect(d).toMatchObject({ title: '세포 신호 전달', date: '2024-03', publisher: '학습출판', language: '', url: '', abstract: '', extra: '' });
    expect(d.creators.map((c) => [c.name, c.role])).toEqual([['한서진', 'author'], ['윤재하', 'editor']]);
    expect(new Set(d.creators.map((c) => c.key)).size).toBe(2);
  });
  it('saves trimmed values, leaves empty fields out, drops rows without a name, keeps the row order', () => {
    const d = base();
    const edited: InfoDraft = { ...d, title: '  고친 제목 ', language: ' 한국어 ', publisher: '', creators: [d.creators[1]!, d.creators[0]!, { key: 'x', name: '  ', role: 'other' }] };
    expect(validateInfo(edited)).toEqual({
      ok: true,
      value: { title: '고친 제목', metadata: { creators: [{ name: '윤재하', role: 'editor' }, { name: '한서진', role: 'author' }], date: '2024-03', language: '한국어' } },
    });
  });
  it('marks each wrong field with its own footnote: the cause, then what to write', () => {
    const r = validateInfo({ ...base(), date: '2024-13', url: 'example.org', title: '   ' });
    if (r.ok) throw new Error('expected marked fields');
    expect(r.errors).toEqual({
      title: '제목은 비워 둘 수 없습니다. 자료를 알아볼 이름을 적으세요.',
      date: '날짜는 2024, 2024-03, 2024-03-15처럼 적어 주세요.',
      url: 'http:// 또는 https://로 시작하는 주소를 적어 주세요.',
    });
  });
  it('tells a value that is too long from one of the wrong form, and marks a creator row by its key', () => {
    const long = (k: number) => 'ㄱ'.repeat(k);
    const d = base();
    const r = validateInfo({ ...d, title: long(501), language: long(36), url: `https://example.org/${long(2048)}`, creators: [{ ...d.creators[0]!, name: long(201) }] });
    if (r.ok) throw new Error('expected marked fields');
    expect(r.errors).toEqual({
      title: '제목은 500자까지 쓸 수 있습니다. 줄여서 다시 적으세요.',
      language: '언어는 35자까지 쓸 수 있습니다. 한국어나 ko처럼 짧게 적으세요.',
      url: 'URL은 2048자까지 쓸 수 있습니다. 줄여서 다시 적으세요.',
      [`creator:${d.creators[0]!.key}`]: '이름은 200자까지 쓸 수 있습니다. 줄여서 다시 적으세요.',
    });
  });
  it('counts as unchanged what saving would not change: spaces around a value, an empty row', () => {
    const d = base();
    expect(sameInfo(d, base())).toBe(true);
    expect(sameInfo({ ...d, publisher: ' 학습출판  ' }, d)).toBe(true);
    expect(sameInfo({ ...d, creators: [...d.creators, { key: 'e', name: '', role: 'author' }] }, d)).toBe(true);
    expect(sameInfo({ ...d, title: '고친 제목' }, d)).toBe(false);
    expect(sameInfo({ ...d, creators: [d.creators[1]!, d.creators[0]!] }, d)).toBe(false);
    expect(sameInfo({ ...d, creators: [{ ...d.creators[0]!, role: 'other' }, d.creators[1]!] }, d)).toBe(false);
  });
});
