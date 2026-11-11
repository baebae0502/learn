import { memo, useMemo, type ReactNode } from 'react';
import { parseAnswer, splitStable, type AnswerBlock, type Inline } from './markdown';

/** How a cite token is drawn: the chip for that 0-based page. */
export type DrawCite = (pageIndex: number) => ReactNode;

/** A word longer than this is not bound to its chip: a line that cannot break would run out of the bubble. */
const BIND_MAX = 24;

/** A cite chip with the word before it and what is attached after it (punctuation, a particle): one piece that never breaks (.cite-tail). */
type Piece = Inline | { kind: 'tail'; word: string; cites: number[]; after: string };

function withTails(inline: readonly Inline[]): Piece[] {
  const out: Piece[] = [];
  for (const node of inline) {
    const last = out.at(-1);
    if (node.kind === 'cite') {
      // "[[p41]][[p42]]" and "[[p41]] [[p42]]": one piece.
      const before = last?.kind === 'text' && /^\s+$/.test(last.text) ? out.at(-2) : last;
      if (before?.kind === 'tail' && before.after === '') {
        if (before !== last) out.pop();
        before.cites.push(node.pageIndex);
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
      out.push({ kind: 'tail', word, cites: [node.pageIndex], after: '' });
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

function Inlines({ inline, cite, caret }: { inline: readonly Inline[]; cite: DrawCite; caret?: ReactNode }) {
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
                <Inlines inline={p.children} cite={cite} />
              </strong>
            );
          case 'em':
            return (
              <em key={k}>
                <Inlines inline={p.children} cite={cite} />
              </em>
            );
          case 'cite':
            return <span key={k}>{cite(p.pageIndex)}</span>;
          case 'tail':
            return (
              <span key={k} className="cite-tail">
                {p.word}
                {p.cites.map((c, j) => (
                  <span key={j}>{cite(c)}</span>
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
function Block({ block, cite, caret }: { block: AnswerBlock; cite: DrawCite; caret?: ReactNode }) {
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <Inlines inline={block.inline} cite={cite} caret={caret} />
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
          <Blocks blocks={block.blocks} cite={cite} caret={caret} />
        </blockquote>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      const lastItem = block.items.length - 1;
      return (
        <Tag>
          {block.items.map((item, k) => (
            <li key={k}>
              <Inlines inline={item.inline} cite={cite} caret={k === lastItem && item.sub === null ? caret : undefined} />
              {item.sub !== null && <Block block={item.sub} cite={cite} caret={k === lastItem ? caret : undefined} />}
            </li>
          ))}
        </Tag>
      );
    }
  }
}

function Blocks({ blocks, cite, caret }: { blocks: readonly AnswerBlock[]; cite: DrawCite; caret?: ReactNode }) {
  return (
    <>
      {blocks.map((b, k) => (
        <Block key={k} block={b} cite={cite} caret={k === blocks.length - 1 ? caret : undefined} />
      ))}
    </>
  );
}

/** The finished blocks of a streaming answer: drawn again only when another block finished or a chip's state changed. */
const StableBlocks = memo(function StableBlocks({ text, cite }: { text: string; cite: DrawCite }) {
  const blocks = useMemo(() => parseAnswer(text), [text]);
  return <Blocks blocks={blocks} cite={cite} />;
});

/**
 * The answer's text (J50): its small Markdown as React elements only — nothing the model wrote becomes markup, a link or a picture.
 * While it streams, the finished blocks are memoised and only the last one is drawn again on each append, with the caret at its end.
 * `cite` draws a page's chip (CitationChip); keep it the same function while the chips' states are the same.
 */
export function AnswerText({ text, streaming, cite }: { text: string; streaming: boolean; cite: DrawCite }) {
  const { stable, tail } = streaming ? splitStable(text) : { stable: text, tail: '' };
  const tailBlocks = useMemo(() => parseAnswer(tail), [tail]);
  const caret = streaming ? <span className="stream-caret" aria-hidden="true" /> : undefined;
  return (
    <>
      {stable !== '' && <StableBlocks text={stable} cite={cite} />}
      {streaming && (tailBlocks.length > 0 ? <Blocks blocks={tailBlocks} cite={cite} caret={caret} /> : caret)}
    </>
  );
}
