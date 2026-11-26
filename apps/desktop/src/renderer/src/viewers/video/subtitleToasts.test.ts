import { describe, expect, it } from 'vitest';
import type { AttachResult, SubtitleTrack } from '@learn/domain';
import { attachToasts } from './subtitleToasts';

const track = (assetId: string): SubtitleTrack => ({ assetId, language: 'ko', position: 0, originalName: `${assetId}.srt`, cueCount: 1 });
const result = (over: Partial<AttachResult>): AttachResult => ({ added: [], already: [], failed: [], ...over });

describe('attachToasts (spec 5.4, 12)', () => {
  it('says what was attached, once, as a success', () => {
    expect(attachToasts(result({ added: [track('a')] }))).toEqual([{ kind: 'success', title: '자막 1개를 붙였습니다', testId: 'subtitle-attached' }]);
    expect(attachToasts(result({ added: [track('a'), track('b')] }))[0]!.title).toBe('자막 2개를 붙였습니다');
  });
  it('says a file that is already on as information', () => {
    expect(attachToasts(result({ already: ['a.ko.srt'] }))).toEqual([{ kind: 'info', title: '이미 붙어 있는 자막입니다', testId: 'subtitle-already' }]);
  });
  it('is one failure toast with a line for each file and the next step', () => {
    const [toast, ...rest] = attachToasts(result({ failed: [{ name: 'a.srt', reason: 'no-cues' }, { name: 'b.srt', reason: 'unreadable' }] }));
    expect(rest).toEqual([]);
    expect(toast).toEqual({
      kind: 'error',
      title: '자막 2개를 붙이지 못했습니다',
      lines: [{ name: 'a.srt', cause: '자막 문장을 찾지 못했습니다' }, { name: 'b.srt', cause: '글자 인코딩을 알아볼 수 없습니다' }],
      body: 'UTF-8로 저장한 뒤 다시 붙이세요. SRT · VTT 형식인지도 확인하세요.',
      testId: 'subtitle-failed',
    });
  });
  it('gives the next step of what failed: the encoding, the format, or where subtitles go', () => {
    const body = (reason: AttachResult['failed'][number]['reason']) => attachToasts(result({ failed: [{ name: 'a.srt', reason }] }))[0]!.body;
    expect(body('unreadable')).toBe('UTF-8로 저장한 뒤 다시 붙이세요.');
    expect(body('no-cues')).toBe('SRT · VTT 형식인지 확인하세요.');
    expect(body('not-subtitle')).toContain('자막 메뉴');
    expect(body('unpaired')).toContain('자막 메뉴');
    expect(body('io')).toBeUndefined();
    expect(body('too-large')).toBeUndefined();
  });
  it('tells the attached, the already-on and the failed one after another', () => {
    const toasts = attachToasts(result({ added: [track('a')], already: ['b.srt'], failed: [{ name: 'c.srt', reason: 'io' }] }));
    expect(toasts.map((t) => t.testId)).toEqual(['subtitle-attached', 'subtitle-already', 'subtitle-failed']);
  });
  it('says nothing for a cancelled panel', () => {
    expect(attachToasts(result({}))).toEqual([]);
  });
});
