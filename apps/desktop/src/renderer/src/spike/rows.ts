// Synthetic library rows for the M4 table spike (branch m4-spike only): the same 10,000 rows on every machine.

export interface SpikeRow {
  id: string;
  title: string;
  creators: string[];
  year: number | null;
  type: 'pdf' | 'video';
  createdAt: string;
  storageMode: 'managed' | 'linked';
  availability: 'available' | 'missing';
  size: number;
}

export type SpikeSortColumn = 'title' | 'creators' | 'year' | 'type' | 'createdAt';

/** mulberry32: a small seeded generator, so Linux and the Mac measure identical rows. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KO = ['세포 신호 전달', '선형대수 강의', '효소 억제제의 작용', '단백질 접힘', '양자역학 입문', '열역학 제2법칙', '미분방정식 풀이', '한국 근대사', '신경망 기초', '유전체 분석'];
const EN = ['Signal Transduction', 'Linear Algebra Lecture', 'Enzyme Kinetics', 'Protein Folding', 'Quantum Mechanics', 'Zebrafish Development', 'Graph Theory', 'Statistical Learning', 'Organic Chemistry', 'Cell Biology'];
const NAMES = ['김민준', '이서연', '박지호', 'Alice Kim', 'John Smith', '최유나', 'Maria Garcia', '정하늘', 'Wei Zhang', '한도윤'];

/** Korean and English titles, 0–4 creators, some without a year, 20 % linked, 3 % missing, one hour apart. */
export function makeRows(n: number, seed = 20261023): SpikeRow[] {
  const rnd = seeded(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const base = Date.UTC(2026, 9, 23);
  const rows: SpikeRow[] = [];
  for (let i = 0; i < n; i++) {
    const creators = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(NAMES));
    rows.push({
      id: `row-${String(i).padStart(5, '0')}`,
      title: `${rnd() < 0.6 ? pick(KO) : pick(EN)} ${i + 1}`,
      creators: rnd() < 0.1 ? [] : creators,
      year: rnd() < 0.15 ? null : 1990 + Math.floor(rnd() * 37),
      type: rnd() < 0.7 ? 'pdf' : 'video',
      createdAt: new Date(base - i * 3_600_000).toISOString(),
      storageMode: rnd() < 0.2 ? 'linked' : 'managed',
      availability: rnd() < 0.03 ? 'missing' : 'available',
      size: Math.floor(rnd() * 200_000_000),
    });
  }
  return rows;
}

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const isEmpty = (column: SpikeSortColumn, r: SpikeRow): boolean => (column === 'year' && r.year === null) || (column === 'creators' && r.creators.length === 0);

/** Both values present. */
function compare(column: SpikeSortColumn, a: SpikeRow, b: SpikeRow): number {
  switch (column) {
    case 'title':
      return collator.compare(a.title, b.title);
    case 'creators':
      return collator.compare(a.creators[0]!, b.creators[0]!);
    case 'year':
      return a.year! - b.year!;
    case 'type':
      return collator.compare(a.type, b.type);
    case 'createdAt':
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  }
}

/** Spec 3.1's order: the Korean collator (numeric), empty values last in either direction, ties by 추가일 newest first, then id. */
export function sortRows(rows: readonly SpikeRow[], column: SpikeSortColumn, direction: 'ascending' | 'descending'): SpikeRow[] {
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ea = isEmpty(column, a);
    const eb = isEmpty(column, b);
    if (ea !== eb) return ea ? 1 : -1;
    const d = ea ? 0 : compare(column, a, b);
    if (d !== 0) return sign * d;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
