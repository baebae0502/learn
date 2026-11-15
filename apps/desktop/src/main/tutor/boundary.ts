import { randomBytes } from 'node:crypto';

/*
 * The one place the boundary markers are made. Every piece of a document an agent sees — a page's text, the attached
 * passage, an outline title, the document's title — goes inside a marker whose nonce is new for each ACP session, so text
 * from a PDF can neither close its block nor open one that looks like Learn's.
 */

const NONCE = /^[0-9a-f]{12}$/;

/** Twelve hex digits, new for each ACP session. */
export function newNonce(): string {
  return randomBytes(6).toString('hex');
}

function checkedNonce(nonce: string): string {
  // An empty or malformed nonce would scrub nothing and mark nothing apart.
  if (!NONCE.test(nonce)) throw new Error('a boundary nonce is twelve hex digits');
  return nonce;
}

/**
 * The nonce taken out first (until none is left: taking one out can join two halves into another), then every <<< and
 * >>> turned into ‹‹‹ and ›››, so taking the nonce out cannot join brackets into a marker either.
 */
export function scrubMaterial(text: string, nonce: string): string {
  const n = checkedNonce(nonce);
  let out = text;
  while (out.includes(n)) out = out.split(n).join('');
  return out.replaceAll('<<<', '‹‹‹').replaceAll('>>>', '›››');
}

/** `page` is the 1-based page number the agent reads it under. */
export function wrapMaterial(text: string, nonce: string, attr: { page: number } | 'title' | 'outline' | 'selection'): string {
  const n = checkedNonce(nonce);
  const label = typeof attr === 'string' ? attr : `page=${attr.page}`;
  return `<<<LEARN-MATERIAL ${n} ${label}>>>\n${scrubMaterial(text, n)}\n<<<END LEARN-MATERIAL ${n}>>>`;
}

/**
 * The earlier turns replayed into a new ACP session. They are plain text and scrubbed like material: an earlier answer
 * cannot close the block, and no marker may be nested inside it.
 */
export function wrapHistory(text: string, nonce: string): string {
  const n = checkedNonce(nonce);
  return `<<<LEARN-HISTORY ${n}>>>\n${scrubMaterial(text, n)}\n<<<END LEARN-HISTORY ${n}>>>`;
}
