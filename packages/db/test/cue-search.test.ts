import { bodyQueryWords, MARK_START, newId, nowIso, type Cue } from '@learn/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CUE_WALK_MAX, LibraryRepository, SubtitlesRepository, cueItemIds, cueLikeChunks, cueMatches, type AssetRow, type Db } from '../src/index';
import { freshDb, seedItem } from './fixtures';

let db: Db;
let subs: SubtitlesRepository;
beforeEach(() => {
  db = freshDb();
  subs = new SubtitlesRepository(db);
});
afterEach(() => db.close());

let seq = 0;
function track(itemId: string, texts: string[], over: { asset?: AssetRow } = {}): AssetRow {
  seq += 1;
  const sha = (0x2000 + seq).toString(16).padStart(64, 'b');
  const asset: AssetRow = over.asset ?? {
    id: newId(), sha256: sha, storageMode: 'managed', relativePath: `assets/${sha.slice(0, 2)}/${sha}`, externalPath: null,
    originalName: 'a.srt', mime: 'application/x-subrip', size: 9, availability: 'available', createdAt: nowIso(), checkedAt: nowIso(),
  };
  const cues: Cue[] = texts.map((text, i) => ({ startMs: i * 1000, endMs: i * 1000 + 900, text: text.normalize('NFC') }));
  subs.attach({ itemId, asset, assetIsNew: !over.asset, revision: over.asset ? null : { id: newId(), createdAt: nowIso() }, language: null, cues, createdAt: nowIso() });
  return asset;
}
const find = (query: string): string[] => {
  const words = bodyQueryWords(query);
  const ids = words.fts.length > 0 ? cueItemIds(db, words) : [...cueLikeChunks(db, words.like)].flat();
  return [...new Set(ids)].sort();
};
const video = () => seedItem(db, { type: 'video' }).itemId;

describe('cue queries', () => {
  it('two long words must share one cue', () => {
    const same = video();
    const split = video();
    track(same, ['칼슘 펌프가 작동한다', '다음 문장']);
    track(split, ['칼슘 이온', '세포막 펌프']);
    expect(find('칼슘 펌프')).toEqual([same]);
    expect(find('칼슘')).toEqual([same, split].sort()); // positive control: the split one is indexed
  });

  it('a two-letter word is found by the scan, and with a long word in one cue', () => {
    const a = video();
    const b = video();
    track(a, ['세포 분열을 본다']);
    track(b, ['세포', '분열을 본다']);
    expect(find('세포')).toEqual([a, b].sort());
    expect(find('세포 분열을')).toEqual([a]);
  });

  it('leaves out a trashed video and a removed subtitle link', () => {
    const a = video();
    const b = video();
    const bTrack = track(b, ['형광 현미경']);
    track(a, ['형광 현미경']);
    expect(find('현미경')).toEqual([a, b].sort());
    new LibraryRepository(db).trash([a]);
    expect(find('현미경')).toEqual([b]);
    expect(find('형광')).toEqual([b]);
    subs.remove(b, bTrack.id);
    expect(find('현미경')).toEqual([]);
    expect(find('형광')).toEqual([]);
  });

  it('cueLikeChunks visits every chunk', () => {
    const a = video();
    track(a, Array.from({ length: 9 }, (_, i) => `세포 ${i}`));
    const chunks = [...cueLikeChunks(db, ['세포'], 2)];
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.flat())).toEqual(new Set([a]));
    expect([...cueLikeChunks(db, [], 2)]).toEqual([]);
  });
});

describe('cueMatches', () => {
  it('gives the cues in time order with marked snippets; track is the asset id only with two or more tracks', () => {
    const a = video();
    const one = track(a, ['처음', '칼슘 펌프', '중간', '칼슘 이온']);
    const words = bodyQueryWords('칼슘');
    const r = cueMatches(db, a, words);
    expect(r.total).toBe(2);
    expect(r.matches.map((m) => [m.startMs, m.track])).toEqual([[1000, null], [3000, null]]);
    expect(r.matches[0]!.snippet).toContain(MARK_START);
    expect(r.matches[0]!.kind).toBe('time');
    const two = track(a, ['칼슘 영어']);
    const r2 = cueMatches(db, a, words);
    expect(r2.matches.map((m) => [m.startMs, m.track])).toEqual([[0, two.id], [1000, one.id], [3000, one.id]]);
  });

  it('a two-letter query uses the LIKE snippet', () => {
    const a = video();
    track(a, ['앞 세포 뒤']);
    const r = cueMatches(db, a, bodyQueryWords('세포'));
    expect(r.total).toBe(1);
    expect(r.matches[0]!.snippet).toContain(MARK_START);
  });

  it('shows 20 rows and counts all 25', () => {
    const a = video();
    track(a, Array.from({ length: 25 }, (_, i) => `칼슘 ${i}`));
    const r = cueMatches(db, a, bodyQueryWords('칼슘'));
    expect(r.matches).toHaveLength(20);
    expect(r.total).toBe(25);
    const l = cueMatches(db, a, bodyQueryWords('칼슘'.slice(0, 2)));
    expect(l.matches).toHaveLength(20);
    expect(l.total).toBe(25);
  });

  it('a long video is read from the index and answers as a short one does', () => {
    const a = video();
    const b = video();
    const texts = Array.from({ length: CUE_WALK_MAX + 10 }, (_, i) => (i % 7 === 0 ? `칼슘 ${i}` : `다른 ${i}`));
    track(a, texts);
    track(b, ['칼슘 다른 영상']);
    const r = cueMatches(db, a, bodyQueryWords('칼슘'));
    expect(r.total).toBe(Math.ceil(texts.length / 7));
    expect(r.matches.map((m) => m.startMs)).toEqual([0, 7000, 14000, 21000, 28000, 35000, 42000, 49000, 56000, 63000, 70000]);
    expect(r.matches.every((m) => m.track === null && m.snippet.includes(MARK_START))).toBe(true);
    const and = cueMatches(db, a, bodyQueryWords('칼슘 14'));
    expect(and.matches.map((m) => m.startMs)).toEqual([14000]);
  });

  it('a long video whose two tracks surround another video\'s cues does not show them', () => {
    const a = video();
    const b = video();
    const long = (tag: string) => Array.from({ length: CUE_WALK_MAX + 1 }, (_, i) => `칼슘 ${tag}${i}`);
    const one = track(a, long('가'));
    track(b, long('나'));
    const two = track(a, long('다'));
    const r = cueMatches(db, a, bodyQueryWords('칼슘'));
    expect(r.total).toBe(2 * (CUE_WALK_MAX + 1));
    expect(r.matches).toHaveLength(20);
    expect(r.matches.slice(0, 2).map((m) => [m.startMs, m.track])).toEqual([[0, one.id], [0, two.id]]);
    expect(r.matches.every((m) => !m.snippet.includes('나'))).toBe(true);
  });

  it('another video, a trashed one and a PDF give none', () => {
    const a = video();
    const b = video();
    track(a, ['칼슘']);
    expect(cueMatches(db, b, bodyQueryWords('칼슘')).total).toBe(0);
    new LibraryRepository(db).trash([a]);
    expect(cueMatches(db, a, bodyQueryWords('칼슘'))).toEqual({ matches: [], total: 0 });
    expect(cueMatches(db, seedItem(db).itemId, bodyQueryWords('칼슘'))).toEqual({ matches: [], total: 0 });
  });
});
