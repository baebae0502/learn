// Generates self-made, license-free test media. Uses argument arrays only (no shell strings).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'generated');
fs.mkdirSync(out, { recursive: true });
const force = process.argv.includes('--force');
const need = (name) => force || !fs.existsSync(path.join(out, name));

async function makePdf(file, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(`Learn fixture: ${label}`);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} - page ${i}`, { x: 56, y: 770, size: 22, font });
    page.drawText('A signaling cascade can amplify an initial molecular event.', { x: 56, y: 730, size: 12, font });
    page.drawRectangle({ x: 56, y: 560, width: 220, height: 120, borderColor: rgb(0.18, 0.5, 0.48), borderWidth: 3 });
    if (i === 2) page.setRotation(degrees(90));
  }
  fs.writeFileSync(file, await doc.save());
}

// ---- paper-100.pdf: a two-column paper for the reader (text layer, links, outline, long scroll) -------------------

const PAPER_PAGES = 100;
const PAPER_SENTENCES = [
  'Attention is all you need.',
  'The dominant sequence transduction models are based on complex recurrent neural networks.',
  'We propose a new simple network architecture.',
  'It is based solely on attention mechanisms.',
];
const FILLER = [
  'Recurrent models factor computation along the symbol positions of the input and output sequences.',
  'Aligning the positions to steps in computation time, they generate a sequence of hidden states.',
  'This inherently sequential nature precludes parallelization within training examples.',
  'Attention mechanisms allow modeling of dependencies without regard to their distance in the sequences.',
  'The Transformer allows for significantly more parallelization and reaches a new state of the art.',
  'Each layer has two sub-layers: a multi-head self-attention mechanism and a position-wise feed-forward network.',
];

/** Greedy line breaking at a column width, in the font's own metrics. */
function wrap(text, font, size, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const outlineNodes = () => {
  const chapters = [];
  for (let c = 0; c < 10; c++) {
    const sections = [];
    for (let s = 0; s < 3; s++) {
      const subs = [0, 1].map((u) => ({ title: `${c + 1}.${s + 1}.${u + 1} Subsection`, page: c * 10 + s * 3 + u + 1, children: [] }));
      sections.push({ title: `${c + 1}.${s + 1} Section`, page: c * 10 + s * 3 + 1, children: subs });
    }
    chapters.push({ title: `Chapter ${c + 1}`, page: c * 10 + 1, children: sections });
  }
  return chapters;
};

/** The outline tree through pdf-lib's low-level objects: chapters, sections, subsections, all open. */
function writeOutline(doc, nodes) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const visible = (n) => n.children.length + n.children.reduce((sum, c) => sum + visible(c), 0);
  const build = (items, parent) => {
    const refs = items.map(() => ctx.nextRef());
    items.forEach((n, i) => {
      const entries = {
        Title: PDFHexString.fromText(n.title),
        Parent: parent,
        Dest: [pages[n.page - 1].ref, PDFName.of('XYZ'), null, null, null],
      };
      if (i > 0) entries.Prev = refs[i - 1];
      if (i < items.length - 1) entries.Next = refs[i + 1];
      if (n.children.length > 0) {
        const kids = build(n.children, refs[i]);
        entries.First = kids[0];
        entries.Last = kids[kids.length - 1];
        entries.Count = visible(n);
      }
      ctx.assign(refs[i], ctx.obj(entries));
    });
    return refs;
  };
  const root = ctx.nextRef();
  const top = build(nodes, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: nodes.reduce((sum, n) => sum + 1 + visible(n), 0) }));
  doc.catalog.set(PDFName.of('Outlines'), root);
}

function addLink(doc, page, rect, action) {
  const ctx = doc.context;
  const ref = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...action }));
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (annots) annots.push(ref);
  else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
}

async function makePaper(file) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle('Learn fixture: paper of 100 pages');
  const pages = Array.from({ length: PAPER_PAGES }, () => doc.addPage([595, 842]));
  const COLUMN = { width: 235, x: [56, 304] };
  const LEAD = 13;
  pages.forEach((page, index) => {
    const n = index + 1;
    // Page 1 starts with the four sentences the translation tests select, each on a line of its own and first in the
    // content stream, so the text layer reads them first.
    let top = 770;
    if (n === 1) {
      PAPER_SENTENCES.forEach((line, i) => page.drawText(line, { x: 56, y: 770 - i * LEAD, size: 10, font }));
      top = 770 - PAPER_SENTENCES.length * LEAD - 10;
    }
    page.drawText(`Attention study - page ${n}`, { x: 56, y: 806, size: 14, font: bold });
    const bottom = n === 1 ? 200 : 90;
    const perColumn = Math.floor((top - bottom) / LEAD);
    let lines;
    if (n === 2) {
      // A word broken across lines with a hyphen, at the head of the first paragraph.
      lines = ['The dominant sequence transduc-', 'tion models are based on complex recurrent', 'neural networks that include an encoder.'];
    } else lines = [];
    let k = n;
    while (lines.length < perColumn * 2) {
      lines.push(...wrap(`${FILLER[k % FILLER.length]} ${FILLER[(k + 1) % FILLER.length]}`, font, 10, COLUMN.width));
      k += 2;
    }
    lines.slice(0, perColumn * 2).forEach((line, i) => {
      const column = Math.floor(i / perColumn);
      page.drawText(line, { x: COLUMN.x[column], y: top - (i % perColumn) * LEAD, size: 10, font });
    });
    if (n % 5 === 0) page.drawRectangle({ x: 56, y: 100, width: 483, height: 60, borderColor: rgb(0.18, 0.5, 0.48), borderWidth: 2 });
    // The target of the "See figure 2 on page 40." link (XYZ 56, 600) is a figure: its top-left corner is the point the link lands on.
    if (n === 40) {
      page.drawRectangle({ x: 56, y: 520, width: 483, height: 80, color: rgb(1, 1, 1), borderColor: rgb(0.18, 0.5, 0.48), borderWidth: 2 });
      page.drawText('Figure 2', { x: 66, y: 580, size: 12, font: bold, color: rgb(0.18, 0.5, 0.48) });
    }
    page.drawText(`${n}. Footnote of page ${n}.`, { x: 56, y: 60, size: 8, font });
  });
  const first = pages[0];
  const link = (y, label, action) => {
    first.drawText(label, { x: 56, y, size: 10, font, color: rgb(0.1, 0.25, 0.7) });
    addLink(doc, first, [56, y - 2, 56 + font.widthOfTextAtSize(label, 10), y + 10], action);
  };
  link(170, 'See page 50.', { Dest: [pages[49].ref, PDFName.of('XYZ'), null, null, null] });
  link(157, 'See page 100.', { Dest: [pages[99].ref, PDFName.of('XYZ'), null, null, null] });
  link(144, 'https://example.org/learn', { A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org/learn') } });
  link(131, 'mailto:learn@example.org', { A: { Type: 'Action', S: 'URI', URI: PDFString.of('mailto:learn@example.org') } });
  link(118, 'See figure 2 on page 40.', { Dest: [pages[39].ref, PDFName.of('XYZ'), 56, 600, null] });
  writeOutline(doc, outlineNodes());
  fs.writeFileSync(file, await doc.save());
}

// ---- long-outline.pdf: 300 outline entries over 6 pages (the sidebar draws a list this long virtualised) ------------
async function makeLongOutline(file) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Learn fixture: long outline');
  for (let i = 1; i <= 6; i++) doc.addPage([595, 842]).drawText(`Long outline - page ${i}`, { x: 56, y: 780, size: 18, font });
  const chapters = Array.from({ length: 60 }, (_, c) => ({
    title: `Part ${c + 1}`,
    page: Math.floor((c * 6) / 60) + 1,
    children: Array.from({ length: 4 }, (_, s) => ({ title: `${c + 1}.${s + 1} Topic`, page: Math.floor((c * 6) / 60) + 1, children: [] })),
  }));
  writeOutline(doc, chapters);
  fs.writeFileSync(file, await doc.save());
}

// ---- korean.pdf: Korean text for the text layer (page 2 is the same paragraph decomposed) ---------------------------
// The variable font is embedded whole: fontkit cannot subset it. pdf.js draws no glyphs from it, but the text content and
// the glyph widths are right, which is all the text layer needs.

const KOREAN_LINES = ['주의 메커니즘은 중요합니다. Attention matters.', '변환기는 순환 없이 문장을 한꺼번에 읽습니다.', '이 문단은 글 선택과 복사를 시험합니다.'];

async function makeKorean(file) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = fs.readFileSync(path.join(here, '../apps/desktop/src/renderer/src/design/fonts/PretendardVariable.woff2'));
  const font = await doc.embedFont(bytes, { subset: false });
  doc.setTitle('Learn fixture: Korean text');
  const paragraph = (page, lines, x, y, width, use = font) => {
    let at = y;
    for (const line of lines) {
      for (const part of wrap(line, use, 11, width)) {
        page.drawText(part, { x, y: at, size: 11, font: use });
        at -= 15;
      }
    }
  };
  const one = doc.addPage([595, 842]);
  paragraph(one, KOREAN_LINES, 56, 760, 483);
  // Page 2 draws the same glyphs from a second copy of the font; its ToUnicode map is replaced below so the extracted
  // text is the decomposed (NFD) form, which the font has no glyphs for.
  const twoFont = await doc.embedFont(bytes, { subset: false });
  const two = doc.addPage([595, 842]);
  paragraph(two, KOREAN_LINES, 56, 760, 483, twoFont);
  const three = doc.addPage([595, 842]);
  paragraph(three, ['왼쪽 단 주의 메커니즘은 중요합니다.', 'Left column attention matters.'], 56, 760, 235);
  paragraph(three, ['오른쪽 단 변환기는 순환이 없습니다.', 'Right column no recurrence.'], 304, 760, 235);
  const saved = await PDFDocument.load(await doc.save());
  const resources = saved.getPage(1).node.Resources();
  const fonts = resources.lookup(PDFName.of('Font'), PDFDict);
  const fontDict = fonts.lookup(fonts.keys()[0], PDFDict);
  const face = fontkit.create(bytes);
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  const mapped = new Map();
  for (const ch of new Set(KOREAN_LINES.join(''))) {
    mapped.set(face.layout(ch).glyphs[0].id, [...ch.normalize('NFD')].map((c) => hex(c.codePointAt(0))).join(''));
  }
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    `${mapped.size} beginbfchar`,
    ...[...mapped].map(([gid, to]) => `<${hex(gid)}> <${to}>`),
    'endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  saved.context.assign(fontDict.get(PDFName.of('ToUnicode')), saved.context.flateStream(cmap));
  fs.writeFileSync(file, await saved.save());
}

// ffmpeg is only touched when a video fixture is actually missing, so a warm fixture dir needs no ffmpeg.
const runFfmpeg = (args, opts) => {
  try {
    return execFileSync('ffmpeg', args, opts);
  } catch (e) {
    if (e?.code === 'ENOENT') throw new Error('ffmpeg not found on PATH — needed to generate the missing video fixtures');
    throw e;
  }
};
const ffmpeg = (args) => runFfmpeg(['-v', 'error', '-y', ...args], { stdio: 'inherit' });
let encoders;
const has = (name) => {
  encoders ??= runFfmpeg(['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return new RegExp(`\\s${name}\\s`).test(encoders);
};

if (need('sample.pdf')) await makePdf(path.join(out, 'sample.pdf'), 'Sample PDF');
if (need('한글 경로 (테스트) #1.pdf')) await makePdf(path.join(out, '한글 경로 (테스트) #1.pdf'), 'Korean path PDF');
if (need('paper-100.pdf')) await makePaper(path.join(out, 'paper-100.pdf'));
if (need('long-outline.pdf')) await makeLongOutline(path.join(out, 'long-outline.pdf'));
if (need('korean.pdf')) await makeKorean(path.join(out, 'korean.pdf'));
// Encrypted PDFs cannot be made with pdf-lib: the committed file is made once with mutool (fixtures/static/README.md).
if (need('locked.pdf')) fs.copyFileSync(path.join(here, 'static', 'locked.pdf'), path.join(out, 'locked.pdf'));

// The five committed raster images (fixtures/static/images), copied so a spec reads them from one folder; png-named.jpg is
// transparent.png under a wrong extension.
for (const name of ['transparent.png', 'orient6.jpg', 'alpha.webp', 'two-frames.gif', 'still.avif']) {
  if (need(name)) fs.copyFileSync(path.join(here, 'static', 'images', name), path.join(out, name));
}
if (need('png-named.jpg')) fs.copyFileSync(path.join(here, 'static', 'images', 'transparent.png'), path.join(out, 'png-named.jpg'));

if (need('sample-h264-aac.mp4')) {
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '10',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    path.join(out, 'sample-h264-aac.mp4'),
  ]);
}
if (need('sample-mpeg4part2.mp4')) {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-c:v', 'mpeg4', path.join(out, 'sample-mpeg4part2.mp4')]);
}
if (!need('sample-hevc.mp4')) {
  // already present
} else if (has('libx265')) {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-c:v', 'libx265', '-tag:v', 'hvc1', path.join(out, 'sample-hevc.mp4')]);
} else {
  console.warn('libx265 encoder not available — skipping sample-hevc.mp4');
}
console.log(`fixtures written to ${out}`);
