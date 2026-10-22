// Demo content (Task 13 fix round 1, T13-M3): study documents a viewer can believe, instead of test fixtures. Seven
// upright PDFs of 3–5 pages, written for this demo (original text; invented titles, no real books, authors or
// publishers), set in the bundled Pretendard (OFL) through pdf-lib + fontkit; and the two video fixtures copied under
// readable names. Every file differs, so duplicate detection never fires. The test fixtures stay as they are.
import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { FIXTURES, ROOT } from '../e2e/helpers';

/** Pretendard's TrueType builds: fontkit 1.1.1 cannot read the CFF outlines of its .otf files. */
const FONT_DIR = path.join(ROOT, 'apps/desktop/node_modules/pretendard/dist/public/static/alternative');

interface Section {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}
interface Doc {
  file: string;
  title: string;
  subtitle: string;
  pages: Section[];
  /** Page index (0-based) that gets the signalling diagram. */
  diagram?: number;
}

/** The PDF the demo opens (by ⌘O, then F6 + ↩): pages 1 → 2. */
export const READ_TITLE = '세포 신호 전달 개요';
/** The unplayable video the demo opens. */
export const UNPLAYABLE_TITLE = '옛 강의 녹화 (MPEG-4)';

const DOCS: Doc[] = [
  {
    file: `${READ_TITLE}.pdf`,
    title: READ_TITLE,
    subtitle: '세포생물학 강의 노트 · 4주차',
    diagram: 1,
    pages: [
      {
        heading: '1. 신호는 어떻게 세포 안으로 들어오는가',
        paragraphs: [
          '세포는 주변 환경의 변화를 화학 신호로 받아들인다. 호르몬, 성장 인자, 신경 전달 물질 같은 신호 분자는 대부분 세포막을 통과하지 못하므로, 세포 표면의 수용체 단백질에 결합하여 정보를 전달한다.',
          '수용체에 신호 분자가 결합하면 수용체의 입체 구조가 바뀌고, 이 변화가 세포 안쪽의 단백질을 차례로 활성화한다. 이렇게 이어지는 반응의 사슬을 신호 전달 경로라고 부른다.',
          '신호 전달의 핵심은 증폭과 조절이다. 수용체 하나가 활성화되면 수백 개의 2차 전령이 만들어지고, 그 결과 작은 자극으로도 세포 전체의 반응을 이끌어 낼 수 있다.',
        ],
        bullets: ['수용 — 신호 분자가 수용체에 결합한다.', '전달 — 세포 안의 단백질이 차례로 활성화된다.', '반응 — 유전자 발현, 대사, 운동 등이 바뀐다.'],
      },
      {
        heading: '2. G 단백질 연결 수용체와 cAMP',
        paragraphs: [
          'G 단백질 연결 수용체(GPCR)는 세포막을 일곱 번 가로지르는 단백질이다. 리간드가 결합하면 수용체가 G 단백질의 α 소단위에 붙어 있던 GDP를 GTP로 바꾸게 한다.',
          '활성화된 α 소단위는 아데닐산 고리화 효소를 자극하여 ATP를 cAMP로 바꾼다. cAMP는 단백질 인산화 효소 A(PKA)를 활성화하고, PKA는 표적 단백질에 인산기를 붙여 그 기능을 바꾼다.',
          '이 경로에서 신호가 커지는 곳은 두 군데이다. 활성화된 수용체 하나가 여러 G 단백질을 차례로 활성화하고, 아데닐산 고리화 효소 하나가 짧은 시간에 많은 cAMP 분자를 만든다.',
          'PKA의 표적은 세포마다 다르다. 간세포에서는 글리코젠 분해가 빨라져 혈당이 오르고, 심장 근육 세포에서는 칼슘 통로가 열려 수축하는 힘이 커진다. 같은 신호가 세포에 따라 다른 결과를 낳는 셈이다.',
        ],
        bullets: ['리간드 결합 → G 단백질 활성화 (GDP → GTP)', 'cAMP 증가 → PKA 활성화', 'PKA → 표적 단백질 인산화 → 세포의 반응'],
      },
      {
        heading: '3. 수용체 티로신 인산화 효소',
        paragraphs: [
          '성장 인자의 수용체는 대개 티로신 인산화 효소 활성을 가진다. 리간드가 결합하면 수용체 두 개가 짝을 이루고, 서로의 티로신 잔기를 인산화한다.',
          '인산화된 티로신은 어댑터 단백질이 붙는 자리가 된다. 대표적인 경로인 Ras–MAPK 경로에서는 일련의 인산화 효소가 차례로 활성화되어 결국 핵 안의 전사 인자를 조절한다.',
          '이 경로의 구성 요소에 돌연변이가 생겨 신호가 꺼지지 않으면 세포가 통제 없이 분열할 수 있다. 여러 항암제가 바로 이 단계를 표적으로 삼는다.',
        ],
      },
      {
        heading: '4. 신호를 끄는 방법과 정리',
        paragraphs: [
          '신호는 켜는 것만큼 끄는 것도 중요하다. α 소단위는 스스로 GTP를 GDP로 가수 분해하여 비활성 상태로 돌아가고, 인산 가수 분해 효소는 cAMP를 분해한다.',
          '수용체 자체도 인산화되거나 세포 안으로 들어가(내재화) 일시적으로 반응하지 않게 된다. 이러한 탈감작 덕분에 세포는 같은 자극이 계속되어도 지나치게 반응하지 않는다.',
        ],
        bullets: ['GPCR: G 단백질 → 2차 전령(cAMP, Ca²⁺) → 인산화 효소', 'RTK: 이량체화 → 자가 인산화 → Ras–MAPK', '종료: GTP 가수 분해, 인산 가수 분해 효소, 내재화'],
      },
    ],
  },
  {
    file: '단백질 접힘 강의 노트.pdf',
    title: '단백질 접힘 강의 노트',
    subtitle: '생화학 II · 2주차 정리',
    pages: [
      {
        heading: '1. 1차 구조가 3차 구조를 정한다',
        paragraphs: [
          '폴리펩타이드 사슬은 리보솜에서 만들어지는 동안부터 접히기 시작한다. 아미노산 서열에는 단백질이 최종적으로 어떤 모양을 가질지에 대한 정보가 대부분 담겨 있다.',
          '소수성 곁사슬은 물을 피해 단백질 안쪽으로 모이고, 친수성 곁사슬은 바깥쪽에 남는다. 이 소수성 붕괴가 접힘의 초기 단계를 이끄는 주된 힘이다.',
        ],
      },
      {
        heading: '2. 에너지 지형과 중간 상태',
        paragraphs: [
          '접힘 과정은 깔때기 모양의 에너지 지형으로 설명할 수 있다. 사슬은 수많은 형태 가운데 에너지가 낮은 쪽으로 이동하며, 도중에 일시적인 중간 상태를 거친다.',
          '잘못 접힌 중간 상태가 서로 엉기면 응집체가 생긴다. 이런 응집은 여러 퇴행성 질환과 관련이 있다고 알려져 있다.',
        ],
        bullets: ['α 나선과 β 병풍은 수소 결합으로 안정된다.', '이황화 결합은 세포 밖 단백질의 구조를 붙잡아 준다.'],
      },
      {
        heading: '3. 샤페론의 역할',
        paragraphs: [
          '샤페론 단백질은 새로 만들어진 사슬이 잘못 접히거나 엉기지 않도록 돕는다. 일부 샤페론은 ATP를 써서 단백질을 감싼 공간 안에서 다시 접힐 기회를 준다.',
          '열 충격처럼 단백질이 풀리기 쉬운 조건에서는 샤페론의 발현이 늘어난다. 끝내 고쳐지지 않는 단백질은 표지가 붙어 분해 경로로 보내진다.',
        ],
      },
    ],
  },
  {
    file: '효소 반응 속도론 정리.pdf',
    title: '효소 반응 속도론 정리',
    subtitle: '생화학 I · 시험 대비 요약',
    pages: [
      {
        heading: '1. 미카엘리스–멘텐 식',
        paragraphs: [
          '효소 반응 속도는 기질 농도가 낮을 때 거의 비례하여 늘다가, 농도가 높아지면 최대 속도 Vmax에 가까워진다. 이 관계를 v = Vmax[S] / (Km + [S])로 나타낸다.',
          'Km은 반응 속도가 최대 속도의 절반이 되는 기질 농도이다. Km이 작을수록 효소가 기질에 잘 결합한다고 해석할 수 있다.',
        ],
      },
      {
        heading: '2. 저해의 종류',
        paragraphs: [
          '경쟁적 저해제는 활성 부위를 두고 기질과 경쟁한다. 기질 농도를 충분히 높이면 저해를 이길 수 있으므로 Vmax는 그대로이고 겉보기 Km만 커진다.',
          '비경쟁적 저해제는 활성 부위가 아닌 곳에 결합하여 효소의 촉매 능력을 떨어뜨린다. 이 경우 Km은 변하지 않고 Vmax가 작아진다.',
        ],
        bullets: ['경쟁적: Km ↑, Vmax 그대로', '비경쟁적: Km 그대로, Vmax ↓', '반경쟁적: Km ↓, Vmax ↓'],
      },
      {
        heading: '3. 실험 데이터 읽기',
        paragraphs: [
          '라인위버–버크 도표는 1/v를 1/[S]에 대해 그린 것으로, 직선의 기울기와 절편에서 Km과 Vmax를 읽을 수 있다. 다만 낮은 기질 농도의 오차가 크게 부풀려지므로 요즘은 비선형 회귀를 함께 쓴다.',
        ],
      },
    ],
  },
  {
    file: '열역학 제2법칙 요약.pdf',
    title: '열역학 제2법칙 요약',
    subtitle: '일반물리 · 단원 정리',
    pages: [
      {
        heading: '1. 엔트로피와 자발적 과정',
        paragraphs: [
          '고립계에서 일어나는 자발적 과정은 엔트로피를 줄이지 않는다. 열이 뜨거운 물체에서 차가운 물체로만 저절로 흐르는 것도 이 법칙의 한 표현이다.',
          '엔트로피는 계가 가질 수 있는 미시 상태의 수와 관련된다. 같은 거시 상태를 만드는 배열이 많을수록 엔트로피가 크다.',
        ],
      },
      {
        heading: '2. 열기관의 효율',
        paragraphs: [
          '열기관은 고온 열원에서 열을 받아 일부를 일로 바꾸고 나머지를 저온 열원에 버린다. 카르노 기관의 효율 1 − Tc/Th는 두 온도 사이에서 가능한 최대 효율이다.',
        ],
        bullets: ['효율은 온도 차이가 클수록 높아진다.', '실제 기관은 마찰과 열 손실 때문에 카르노 효율에 못 미친다.'],
      },
      {
        heading: '3. 생명체와 제2법칙',
        paragraphs: [
          '생명체는 질서를 유지하지만 제2법칙을 어기지 않는다. 먹이에서 얻은 자유 에너지를 쓰면서 주변으로 열을 내보내고, 그 결과 계와 주변을 합친 엔트로피는 늘어난다.',
        ],
      },
    ],
  },
  {
    file: 'Linear Algebra — Eigenvalues.pdf',
    title: 'Linear Algebra — Eigenvalues',
    subtitle: 'Study notes · week 9',
    pages: [
      {
        heading: '1. What an eigenvector is',
        paragraphs: [
          'An eigenvector of a square matrix A is a non-zero vector v whose direction does not change when A is applied: Av = λv. The scalar λ is the matching eigenvalue, the factor by which v is stretched or flipped.',
          'Eigenvectors describe the directions along which a linear map acts like plain scaling. Many problems become simple once they are written in such a basis.',
        ],
      },
      {
        heading: '2. Finding them',
        paragraphs: [
          'The eigenvalues are the roots of the characteristic polynomial det(A − λI) = 0. For each root, the null space of A − λI gives the eigenvectors.',
          'A 2 × 2 example: for A = [[2, 1], [1, 2]] the polynomial is (2 − λ)² − 1, so λ = 1 or λ = 3, with eigenvectors (1, −1) and (1, 1).',
        ],
        bullets: ['Trace = sum of the eigenvalues', 'Determinant = product of the eigenvalues'],
      },
      {
        heading: '3. Diagonalisation',
        paragraphs: [
          'If A has n independent eigenvectors, it can be written as A = PDP⁻¹ with the eigenvectors in P and the eigenvalues on the diagonal of D. Powers then become easy: Aᵏ = PDᵏP⁻¹.',
        ],
      },
      {
        heading: '4. Where it shows up',
        paragraphs: [
          'Principal component analysis takes the eigenvectors of a covariance matrix; Markov chains settle along the eigenvector of eigenvalue 1; vibrating systems oscillate in their eigenmodes.',
        ],
      },
    ],
  },
  {
    file: 'Intro to Bayesian Inference.pdf',
    title: 'Intro to Bayesian Inference',
    subtitle: 'Statistics reading group · session 3',
    pages: [
      {
        heading: '1. Updating a belief',
        paragraphs: [
          'Bayesian inference treats an unknown quantity as uncertain and describes that uncertainty with a probability distribution. Observed data update the prior distribution into a posterior one.',
          'Bayes’ rule ties them together: the posterior is proportional to the likelihood of the data times the prior.',
        ],
      },
      {
        heading: '2. A coin example',
        paragraphs: [
          'Start with a Beta(2, 2) prior on the probability of heads, which mildly favours a fair coin. After 7 heads in 10 tosses the posterior is Beta(9, 5), centred near 0.64.',
          'The more data arrive, the less the prior matters: the posterior narrows around the observed rate.',
        ],
        bullets: ['Prior: what we believe before the data', 'Likelihood: how probable the data are under each value', 'Posterior: the updated belief'],
      },
      {
        heading: '3. Reporting results',
        paragraphs: [
          'A credible interval gives a range that contains the parameter with a stated probability, given the model and the data. Unlike a confidence interval, it can be read that way directly.',
        ],
      },
    ],
  },
  {
    file: '광합성 명반응과 암반응.pdf',
    title: '광합성 명반응과 암반응',
    subtitle: '고등학교 생명과학 II · 정리 노트',
    pages: [
      {
        heading: '1. 명반응: 빛에너지를 화학 에너지로',
        paragraphs: [
          '명반응은 엽록체의 틸라코이드 막에서 일어난다. 광계 II가 빛을 받아 물을 분해하면 산소가 나오고, 전자는 전자 전달계를 따라 광계 I로 이동한다.',
          '전자가 이동하는 동안 수소 이온이 틸라코이드 안쪽에 쌓이고, 이 농도 차이로 ATP 합성 효소가 ATP를 만든다. 광계 I에서는 NADPH가 만들어진다.',
        ],
      },
      {
        heading: '2. 캘빈 회로',
        paragraphs: [
          '캘빈 회로는 스트로마에서 일어나며 명반응이 만든 ATP와 NADPH를 사용한다. 루비스코가 이산화 탄소를 고정하고, 회로가 세 번 돌 때마다 3탄소 당 하나가 회로 밖으로 나간다.',
        ],
        bullets: ['탄소 고정: CO₂ + RuBP → 3PG', '환원: 3PG → G3P (ATP, NADPH 사용)', '재생: G3P → RuBP'],
      },
      {
        heading: '3. 두 반응의 관계',
        paragraphs: [
          '두 반응은 서로의 산물을 주고받는다. 빛이 없으면 ATP와 NADPH가 곧 바닥나므로 캘빈 회로도 멈춘다. 그래서 암반응이라는 이름과 달리 실제로는 낮에 주로 일어난다.',
        ],
      },
    ],
  },
];

const VIDEOS: Array<[string, string]> = [
  ['sample-h264-aac.mp4', '광합성 실험 영상.mp4'],
  ['sample-mpeg4part2.mp4', `${UNPLAYABLE_TITLE}.mp4`],
];

const A4 = { width: 595, height: 842 };
const MARGIN = 64;
const INK = rgb(0.13, 0.14, 0.16);
const MUTED = rgb(0.45, 0.47, 0.5);
const ACCENT = rgb(0.06, 0.45, 0.42);
const RULE = rgb(0.85, 0.86, 0.87);

/** Lines of `text` at `size` that fit `width`: broken at spaces, a word longer than the line by characters. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    let rest = word;
    while (!fits(rest)) {
      let n = rest.length - 1;
      while (n > 1 && !fits(rest.slice(0, n))) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Receptor → G protein → adenylyl cyclase → cAMP → PKA, as boxes and arrows (page 2 of the opened PDF). */
function drawDiagram(page: PDFPage, font: PDFFont, top: number): number {
  const labels = ['수용체 (GPCR)', 'G 단백질', '아데닐산 고리화 효소', 'cAMP', 'PKA'];
  const w = 84;
  const h = 40;
  const gap = (A4.width - 2 * MARGIN - labels.length * w) / (labels.length - 1);
  const y = top - h;
  labels.forEach((label, i) => {
    const x = MARGIN + i * (w + gap);
    page.drawRectangle({ x, y, width: w, height: h, borderColor: ACCENT, borderWidth: 1.2, color: rgb(0.93, 0.97, 0.96) });
    const lines = wrap(label, font, 9, w - 10);
    lines.forEach((l, j) => {
      const tw = font.widthOfTextAtSize(l, 9);
      page.drawText(l, { x: x + (w - tw) / 2, y: y + h / 2 + (lines.length - 1) * 5.5 - j * 11 - 3, size: 9, font, color: INK });
    });
    if (i < labels.length - 1) {
      const ax = x + w + 3;
      const bx = x + w + gap - 3;
      page.drawLine({ start: { x: ax, y: y + h / 2 }, end: { x: bx, y: y + h / 2 }, thickness: 1.2, color: MUTED });
      page.drawLine({ start: { x: bx - 5, y: y + h / 2 + 3.5 }, end: { x: bx, y: y + h / 2 }, thickness: 1.2, color: MUTED });
      page.drawLine({ start: { x: bx - 5, y: y + h / 2 - 3.5 }, end: { x: bx, y: y + h / 2 }, thickness: 1.2, color: MUTED });
    }
  });
  const caption = '그림 1. GPCR–cAMP 경로의 신호 증폭';
  page.drawText(caption, { x: MARGIN, y: y - 20, size: 9, font, color: MUTED });
  return y - 44;
}

async function writePdf(doc: Doc, regular: Uint8Array, semibold: Uint8Array, file: string): Promise<void> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Whole fonts: fontkit's subsetter drops most Hangul glyphs of Pretendard (they render blank).
  const body = await pdf.embedFont(regular);
  const bold = await pdf.embedFont(semibold);
  pdf.setTitle(doc.title);
  pdf.setSubject(doc.subtitle);
  pdf.setCreator('Learn demo');
  const width = A4.width - 2 * MARGIN;
  doc.pages.forEach((section, index) => {
    const page = pdf.addPage([A4.width, A4.height]);
    let y = A4.height - MARGIN;
    if (index === 0) {
      page.drawText(doc.subtitle, { x: MARGIN, y: y - 10, size: 10, font: body, color: ACCENT });
      y -= 40;
      for (const line of wrap(doc.title, bold, 24, width)) {
        page.drawText(line, { x: MARGIN, y, size: 24, font: bold, color: INK });
        y -= 32;
      }
      page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: A4.width - MARGIN, y: y + 8 }, thickness: 0.8, color: RULE });
      y -= 22;
    } else {
      page.drawText(doc.title, { x: MARGIN, y: y + 16, size: 8.5, font: body, color: MUTED });
      y -= 10;
    }
    page.drawText(section.heading, { x: MARGIN, y, size: 14, font: bold, color: INK });
    y -= 28;
    if (doc.diagram === index) y = drawDiagram(page, body, y);
    for (const paragraph of section.paragraphs) {
      for (const line of wrap(paragraph, body, 11, width)) {
        page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: INK });
        y -= 18;
      }
      y -= 10;
    }
    for (const bullet of section.bullets ?? []) {
      wrap(bullet, body, 11, width - 16).forEach((line, i) => {
        if (i === 0) page.drawCircle({ x: MARGIN + 4, y: y + 3.5, size: 1.8, color: ACCENT });
        page.drawText(line, { x: MARGIN + 16, y, size: 11, font: body, color: INK });
        y -= 18;
      });
    }
    const folio = `${index + 1} / ${doc.pages.length}`;
    page.drawText(folio, { x: A4.width - MARGIN - body.widthOfTextAtSize(folio, 9), y: MARGIN / 2, size: 9, font: body, color: MUTED });
  });
  fs.writeFileSync(file, await pdf.save());
}

export interface DemoMedia {
  /** Everything but the PDF to read: the drop (6 PDFs and the 2 videos). */
  drop: string[];
  /** The PDF the demo imports with ⌘O and opens. */
  read: string;
}

/** Writes the demo's files into `dir` (created; emptied first). */
export async function writeDemoMedia(dir: string): Promise<DemoMedia> {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const regular = fs.readFileSync(path.join(FONT_DIR, 'Pretendard-Regular.ttf'));
  const semibold = fs.readFileSync(path.join(FONT_DIR, 'Pretendard-SemiBold.ttf'));
  const files: string[] = [];
  for (const doc of DOCS) {
    const file = path.join(dir, doc.file);
    await writePdf(doc, regular, semibold, file);
    files.push(file);
  }
  for (const [from, to] of VIDEOS) {
    const file = path.join(dir, to);
    fs.copyFileSync(path.join(FIXTURES, from), file);
    files.push(file);
  }
  const read = path.join(dir, `${READ_TITLE}.pdf`);
  return { read, drop: files.filter((f) => f !== read) };
}
