import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUBTITLE_LIMITS } from '@learn/domain';
import { readSubtitle, type SubtitleResult } from '../src/subtitles';
import { cleanCueText, parseSrt, parseTimestamp } from '../src/subtitles/parse';

const fixture = (name: string): Buffer => fs.readFileSync(fileURLToPath(new URL(`../../../fixtures/static/subtitles/${name}`, import.meta.url)));
const enc = (s: string): Buffer => Buffer.from(s, 'utf8');
const ok = (r: SubtitleResult) => {
  if (!r.ok) throw new Error(`not ok: ${r.reason}`);
  return r;
};
const cuesOf = (text: string, name = 'a.srt') => ok(readSubtitle(enc(text), name)).cues;
const srtBlock = (n: number, text: string, ms = 100) => {
  const f = (t: number) => {
    const h = Math.floor(t / 3_600_000);
    const m = Math.floor(t / 60_000) % 60;
    const s = Math.floor(t / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(t % 1000).padStart(3, '0')}`;
  };
  return `${n}\n${f(n * ms)} --> ${f(n * ms + 50)}\n${text}\n\n`;
};
const manyCues = (n: number) => Array.from({ length: n }, (_, i) => srtBlock(i + 1, `문장 ${i + 1}`)).join('');

describe('SRT', () => {
  it('reads CRLF, a missing number, a dot fraction, a missing hour and a coordinate tail', () => {
    const r = ok(readSubtitle(enc('1\r\n00:00:01,000 --> 00:00:02,500 X1:10\r\n안녕하세요\r\n\r\n00:03.5 --> 00:04.25\r\n둘째\r\n'), 'a.srt'));
    expect(r.cues).toEqual([
      { startMs: 1000, endMs: 2500, text: '안녕하세요' },
      { startMs: 3500, endMs: 4250, text: '둘째' },
    ]);
    expect(r.format).toBe('srt');
    expect(r.encoding).toBe('utf-8');
  });
  it('splits blocks that touch without a blank line', () => {
    expect(cuesOf('1\n00:00:01,000 --> 00:00:02,000\n하나\n2\n00:00:03,000 --> 00:00:04,000\n둘\n').map((c) => c.text)).toEqual(['하나', '둘']);
  });
});

describe('VTT', () => {
  const vtt = 'WEBVTT\nLanguage: en\n\nNOTE a note\nstill note\n\nSTYLE\n::cue { color: red }\n\nREGION\nid:r\n\nintro\n00:00:01.000 --> 00:00:02.000 position:10% align:start\nHello\n\n00:02.000 --> 00:03.000\nWorld\n';
  it('keeps the cues and the header language, dropping NOTE, STYLE, REGION, identifiers and settings', () => {
    const r = ok(readSubtitle(enc(vtt), 'a.vtt'));
    expect(r.format).toBe('vtt');
    expect(r.language).toBe('en');
    expect(r.cues).toEqual([
      { startMs: 1000, endMs: 2000, text: 'Hello' },
      { startMs: 2000, endMs: 3000, text: 'World' },
    ]);
  });
  it('lets the name tail beat the header language', () => {
    expect(ok(readSubtitle(enc(vtt), 'a.ko.vtt')).language).toBe('ko');
  });
  it('judges VTT by content, not by extension', () => {
    expect(ok(readSubtitle(enc(vtt), 'a.srt')).format).toBe('vtt');
  });
});

describe('time lines', () => {
  it('splits VTT cues that touch without a blank line, and a header with no blank line', () => {
    const r = ok(readSubtitle(enc('WEBVTT\n00:00:01.000 --> 00:00:02.000\n하나\n2\n00:00:03.000 --> 00:00:04.000\n둘\n'), 'a.vtt'));
    expect(r.cues.map((c) => c.text)).toEqual(['하나', '둘']);
  });
  it('reads a "-->" line that is not a time line as cue text, in SRT and in VTT', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nATP --> ADP\n다음\n\n2\n00:00:03,000 --> 00:00:04,000\n둘\n';
    expect(cuesOf(srt).map((c) => c.text)).toEqual(['ATP --> ADP\n다음', '둘']);
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA --> B\n';
    expect(ok(readSubtitle(enc(vtt), 'a.vtt')).cues.map((c) => c.text)).toEqual(['A --> B']);
  });
  it('treats a line with an unparseable time as text outside any cue', () => {
    expect(cuesOf('00:00:01,000 --> 00:99:02,000\n나쁨\n\n00:00:03,000 --> 00:00:04,000\n좋음\n').map((c) => c.text)).toEqual(['좋음']);
  });
});

describe('cue text', () => {
  it('removes tags and ruby annotations', () => {
    expect(cleanCueText('<i>기울임</i> <font color="red">빨강</font> <c.yellow>노랑</c> <v 교수>말</v> <ruby>漢<rt>한</rt></ruby>')).toBe('기울임 빨강 노랑 말 漢');
  });
  it('removes overrides and time tags, and decodes entities once', () => {
    expect(cleanCueText('{\\an8}위 <00:00:01.000>시각 &amp; &lt;b&gt; &#44032; &#xAC00; &unknown;')).toBe('위 시각 & <b> 가 가 &unknown;');
  });
  it('keeps &nbsp; inside a line and trims it at a line edge like any other space', () => {
    expect(cleanCueText('a&nbsp;b')).toBe('a b');
    expect(cleanCueText('&nbsp;a&nbsp;\n b ')).toBe('a\nb');
    expect(cleanCueText('&lrm;가')).toBe('‎가');
  });
  it('leaves an unknown or inherited entity name as written', () => {
    expect(cleanCueText('a &constructor; b &toString; &__proto__;')).toBe('a &constructor; b &toString; &__proto__;');
  });
  it('keeps a "<" that is not a tag, across a line too', () => {
    expect(cleanCueText('a < b and c > d')).toBe('a < b and c > d');
    expect(cleanCueText('x < y\n그리고 z > w')).toBe('x < y\n그리고 z > w');
    expect(cleanCueText('3 <5 and 7> 2 <b>x</b>')).toBe('3 <5 and 7> 2 x');
  });
  it('folds lines from the fourth into the third', () => {
    expect(cleanCueText('a\nb\nc\nd\ne')).toBe('a\nb\nc d e');
  });
  it('cuts at 1,000 code points with an ellipsis', () => {
    const t = cleanCueText('가'.repeat(1500));
    expect([...t].length).toBe(1000);
    expect(t.endsWith('…')).toBe(true);
  });
  it('parses timestamps', () => {
    expect(parseTimestamp('01:02:03,004')).toBe(3_723_004);
    expect(parseTimestamp('00:03.5')).toBe(3500);
    expect(parseTimestamp('00:00:61,000')).toBeNull();
    expect(parseTimestamp('abc')).toBeNull();
  });
});

describe('cue filtering and order', () => {
  it('drops an empty cue', () => {
    expect(cuesOf('1\n00:00:01,000 --> 00:00:02,000\n<i></i>\n\n2\n00:00:03,000 --> 00:00:04,000\n둘\n').map((c) => c.text)).toEqual(['둘']);
  });
  it('drops a cue whose end is not after its start', () => {
    expect(cuesOf('00:00:02,000 --> 00:00:02,000\nx\n\n00:00:03,000 --> 00:00:02,000\ny\n\n00:00:04,000 --> 00:00:05,000\nz\n').map((c) => c.text)).toEqual(['z']);
  });
  it('drops a cue at 24:00:00,000', () => {
    expect(cuesOf('00:00:01,000 --> 24:00:00,000\nx\n\n00:00:02,000 --> 23:59:59,999\ny\n').map((c) => c.text)).toEqual(['y']);
  });
  it('sorts by start, keeps the original order on ties, and leaves overlaps', () => {
    const c = cuesOf('00:00:05,000 --> 00:00:09,000\n늦음\n\n00:00:01,000 --> 00:00:06,000\n첫째\n\n00:00:01,000 --> 00:00:02,000\n둘째\n');
    expect(c.map((x) => x.text)).toEqual(['첫째', '둘째', '늦음']);
    expect(c[0]!.endMs).toBe(6000);
  });
});

describe('encodings', () => {
  const ko = fixture('lecture-60s.ko.srt');
  const text = ko.toString('utf8');
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const be = Buffer.from(le);
  for (let i = 2; i + 1 < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1]!, be[i]!];
  be[0] = 0xfe;
  be[1] = 0xff;
  const cases: [string, Uint8Array, string][] = [
    ['utf-8', ko, 'utf-8'],
    ['utf-8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ko]), 'utf-8-bom'],
    ['utf-16 LE BOM', le, 'utf-16le'],
    ['utf-16 BE BOM', be, 'utf-16be'],
    ['cp949', fixture('cp949.srt'), 'cp949'],
  ];
  const base = ok(readSubtitle(ko, 'lecture-60s.ko.srt'));
  it('reads the 16 lecture cues', () => {
    expect(base.cues.length).toBe(16);
    expect(base.language).toBe('ko');
    expect(base.cues[0]!.text).toBe('세포막은 물질의 출입을 조절합니다.');
    expect(base.cues.some((c) => c.text.includes('똠 햏 갂'))).toBe(true);
  });
  for (const [label, bytes, encoding] of cases) {
    it(`reads ${label} to the same cues`, () => {
      const r = ok(readSubtitle(bytes, 'lecture-60s.ko.srt'));
      expect(r.encoding).toBe(encoding);
      expect(r.cues).toEqual(base.cues);
    });
  }
});

describe('limits and failures', () => {
  it('rejects more than 5 MiB', () => {
    expect(readSubtitle(new Uint8Array(SUBTITLE_LIMITS.bytes + 1), 'a.srt')).toEqual({ ok: false, reason: 'too-large' });
  });
  it('accepts 20,000 cues and rejects 20,001', () => {
    expect(cuesOf(manyCues(20_000)).length).toBe(20_000);
    expect(readSubtitle(enc(manyCues(20_001)), 'a.srt')).toEqual({ ok: false, reason: 'too-many-cues' });
  });
  it('stops at the 20,001st cue instead of reading the rest', () => {
    const tail = '\n' + '1\n00:30:00,000 --> 00:30:01,000\n' + '<rt>'.repeat(900_000) + 'z\n';
    const bytes = enc(manyCues(20_001) + tail);
    expect(bytes.length).toBeLessThan(SUBTITLE_LIMITS.bytes);
    const text = bytes.toString('utf8');
    // The unlimited parse sees the tail's cue as well; the limited one stops right after the 20,001st.
    expect(parseSrt(text).length).toBe(20_002);
    expect(parseSrt(text, SUBTITLE_LIMITS.cues).length).toBe(20_001);
    expect(readSubtitle(bytes, 'a.srt')).toEqual({ ok: false, reason: 'too-many-cues' });
  });
  it('reports no cues for text without a time line', () => {
    expect(readSubtitle(fixture('broken.srt'), 'broken.srt')).toEqual({ ok: false, reason: 'no-cues' });
  });
  it('reports unreadable for an odd UTF-16 body and for bytes that are neither UTF-8 nor CP949', () => {
    expect(readSubtitle(Uint8Array.from([0xff, 0xfe, 0x41, 0x00, 0x42]), 'a.srt')).toEqual({ ok: false, reason: 'unreadable' });
    expect(readSubtitle(Uint8Array.from([0x80, 0x81]), 'a.srt')).toEqual({ ok: false, reason: 'unreadable' });
  });
  it('parses 20,000 cues quickly', () => {
    const bytes = enc(manyCues(20_000));
    const t0 = performance.now();
    ok(readSubtitle(bytes, 'a.srt'));
    const ms = Math.round(performance.now() - t0);
    console.log('[measure] parse-20000', ms);
    expect(ms).toBeLessThan(1000);
  });
});

describe('adversarial single cues stay linear', () => {
  const head = '1\n00:00:01,000 --> 00:00:02,000\n';
  const MAX = 5 * 1024 * 1024 - 4096;
  const shapes: [string, string][] = [
    ['a long run of spaces inside a line', 'x' + ' '.repeat(200_000) + 'y'],
    ['80,000 "<"', '<'.repeat(80_000)],
    ['80,000 "<" with letters', '<a'.repeat(80_000)],
    ['an unclosed <rt>', '<rt>'.repeat(80_000)],
    ['an unclosed <rp> after text', 'a<rp>'.repeat(80_000)],
    ['an unclosed "{\\"', '{\\'.repeat(80_000)],
    ['80,000 "&" with no ";"', '&amp'.repeat(80_000)],
    ['a single cue of nearly 5 MiB', 'x '.repeat(MAX / 2)],
    ['a single cue of nearly 5 MiB of unclosed <rt>', '<rt>'.repeat(MAX / 4)],
    ['a single cue of nearly 5 MiB of "<"', '<'.repeat(MAX)],
  ];
  for (const [label, body] of shapes) {
    it(`reads ${label} in under a second`, () => {
      const bytes = enc(head + body + 'z\n');
      const t0 = performance.now();
      const r = ok(readSubtitle(bytes, 'a.srt'));
      const ms = Math.round(performance.now() - t0);
      console.log('[measure] adversarial', label, ms);
      expect(r.cues.length).toBe(1);
      // Ten times what two cores measured, so CI load does not flake it; the 80 KB cases sit far below it.
      expect(ms).toBeLessThan(body.length > 1_000_000 ? 5000 : 1000);
    });
  }
});
