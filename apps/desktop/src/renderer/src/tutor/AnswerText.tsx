import { memo, useMemo, type ReactNode } from 'react';
import { parseAnswer, splitStable, type AnswerBlock, type Inline } from './markdown';

/** How a cite token is drawn: the chip for that 0-based page; `ordinal` counts the answer's cites from 0, in reading order. */
export type DrawCite = (pageIndex: number, ordinal: number) => ReactNode;

type CiteNode = Extract<Inline, { kind: 'cite' }>;
/** The cites of some blocks with their ordinals in the whole answer. */
type Ordinals = ReadonlyMap<CiteNode, number>;
interface Draw {
  cite: DrawCite;
  ordinals: Ordinals;
}

/** Numbers the cites of `blocks` in reading order from `from`; `next` is the number after the last. */
function numberCites(blocks: readonly AnswerBlock[], from: number): { ordinals: Ordinals; next: number } {
  const ordinals = new Map<CiteNode, number>();
  let n = from;
  const inline = (nodes: readonly Inline[]) => {
    for (const node of nodes) {
      if (node.kind === 'cite') ordinals.set(node, n++);
      else if (node.kind === 'strong' || node.kind === 'em') inline(node.children);
    }
  };
  const walk = (bs: readonly AnswerBlock[]) => {
    for (const b of bs) {
      if (b.kind === 'p') inline(b.inline);
      else if (b.kind === 'quote') walk(b.blocks);
      else if (b.kind === 'list') {
        for (const it of b.items) {
          inline(it.inline);
          if (it.sub !== null) walk([it.sub]);
          walk(it.blocks ?? []);
        }
      }
    }
  };
  walk(blocks);
  return { ordinals, next: n };
}

/** A word longer than this is not bound to its chip: a line that cannot break would run out of the bubble. */
const BIND_MAX = 24;

/** A cite chip with the word before it and what is attached after it (punctuation, a particle): one piece that never breaks (.cite-tail). */
type Piece = Inline | { kind: 'tail'; word: string; cites: CiteNode[]; after: string };

function withTails(inline: readonly Inline[]): Piece[] {
  const out: Piece[] = [];
  for (const node of inline) {
    const last = out.at(-1);
    if (node.kind === 'cite') {
      // "[[p41]][[p42]]" and "[[p41]] [[p42]]": one piece.
      const before = last?.kind === 'text' && /^\s+$/.test(last.text) ? out.at(-2) : last;
      if (before?.kind === 'tail' && before.after === '') {
        if (before !== last) out.pop();
        before.cites.push(node);
        continue;
      }
      let word = '';
      if (last?.kind === 'text') {
        const m = /(\S+)\s*$/.exec(last.text);
        if (m && m[1]!.length <= BIND_MAX) {
          word = m[1]!;
          const head = last.text.slice(0, m.index);
          if (head === '') out.pop();
          else out[out.length - 1] = { kind: 'text', text: head };
        }
      }
      out.push({ kind: 'tail', word, cites: [node], after: '' });
      continue;
    }
    if (node.kind === 'text' && last?.kind === 'tail' && last.after === '') {
      const m = /^\S+/.exec(node.text);
      if (m && m[0].length <= BIND_MAX) {
        last.after = m[0];
        const rest = node.text.slice(m[0].length);
        if (rest !== '') out.push({ kind: 'text', text: rest });
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

function Inlines({ inline, draw, caret }: { inline: readonly Inline[]; draw: Draw; caret?: ReactNode }) {
  const chip = (c: CiteNode) => draw.cite(c.pageIndex, draw.ordinals.get(c) ?? 0);
  return (
    <>
      {withTails(inline).map((p, k) => {
        switch (p.kind) {
          case 'text':
            return p.text;
          case 'break':
            return <br key={k} />;
          case 'code':
            return <code key={k}>{p.text}</code>;
          case 'strong':
            return (
              <strong key={k}>
                <Inlines inline={p.children} draw={draw} />
              </strong>
            );
          case 'em':
            return (
              <em key={k}>
                <Inlines inline={p.children} draw={draw} />
              </em>
            );
          case 'cite':
            return <span key={k}>{chip(p)}</span>;
          case 'tail':
            return (
              <span key={k} className="cite-tail">
                {p.word}
                {p.cites.map((c, j) => (
                  <span key={j}>{chip(c)}</span>
                ))}
                {p.after}
              </span>
            );
        }
      })}
      {caret}
    </>
  );
}

/** One block as React elements; `caret` goes at the end of its last line (the answer is being written there). */
function Block({ block, draw, caret }: { block: AnswerBlock; draw: Draw; caret?: ReactNode }) {
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <Inlines inline={block.inline} draw={draw} caret={caret} />
        </p>
      );
    case 'code':
      return (
        <pre className="answer-code">
          <code>{block.text}</code>
          {caret}
        </pre>
      );
    case 'quote':
      return (
        <blockquote>
          <Blocks blocks={block.blocks} draw={draw} caret={caret} />
        </blockquote>
      );
    case 'list': {
      const last = block.items.length - 1;
      const items = block.items.map((item, k) => {
        const more = item.blocks ?? [];
        const end = k === last ? caret : undefined;
        return (
          <li key={k}>
            <Inlines inline={item.inline} draw={draw} caret={item.sub === null && more.length === 0 ? end : undefined} />
            {item.sub !== null && <Block block={item.sub} draw={draw} caret={more.length === 0 ? end : undefined} />}
            {more.length > 0 && <Blocks blocks={more} draw={draw} caret={end} />}
          </li>
        );
      });
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
  }
}

function Blocks({ blocks, draw, caret }: { blocks: readonly AnswerBlock[]; draw: Draw; caret?: ReactNode }) {
  return (
    <>
      {blocks.map((b, k) => (
        <Block key={k} block={b} draw={draw} caret={k === blocks.length - 1 ? caret : undefined} />
      ))}
    </>
  );
}

/** The finished blocks of a streaming answer: drawn again only when another block finished or a chip's state changed. */
const StableBlocks = memo(function StableBlocks({ blocks, ordinals, cite }: { blocks: readonly AnswerBlock[]; ordinals: Ordinals; cite: DrawCite }) {
  return <Blocks blocks={blocks} draw={{ cite, ordinals }} />;
});

/**
 * The answer's text: its small Markdown as React elements only — nothing the model wrote becomes markup, a link or a picture.
 * While it streams, the finished blocks are memoised and only the last one is drawn again on each append, with the caret at its end.
 * `cite` draws a page's chip (CitationChip) by its page and its ordinal in the answer; keep it the same function while the chips'
 * states are the same.
 */
export function AnswerText({ text, streaming, cite }: { text: string; streaming: boolean; cite: DrawCite }) {
  const { stable, tail } = streaming ? splitStable(text) : { stable: text, tail: '' };
  const stableBlocks = useMemo(() => parseAnswer(stable), [stable]);
  const stableCites = useMemo(() => numberCites(stableBlocks, 0), [stableBlocks]);
  const tailBlocks = useMemo(() => parseAnswer(tail), [tail]);
  const tailCites = useMemo(() => numberCites(tailBlocks, stableCites.next), [tailBlocks, stableCites.next]);
  const caret = streaming ? <span className="stream-caret" aria-hidden="true" /> : undefined;
  return (
    <>
      {stableBlocks.length > 0 && <StableBlocks blocks={stableBlocks} ordinals={stableCites.ordinals} cite={cite} />}
      {streaming && (tailBlocks.length > 0 ? <Blocks blocks={tailBlocks} draw={{ cite, ordinals: tailCites.ordinals }} caret={caret} /> : caret)}
    </>
  );
}
