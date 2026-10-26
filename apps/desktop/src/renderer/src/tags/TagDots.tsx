import type { OrganizeTag } from '@learn/domain';
import { tagColorVar } from './tagColor';
import { dotTags } from './tagDots';

/**
 * The colour dots after a table title (spec 5.1; mockup .tag-dots): one 8 px dot per coloured tag, by slot, with a 0.5 px
 * inner border (a white 1 px ring on the accent-filled row — chip.css). Decoration: the row's description says the names.
 */
export function TagDots({ tags }: { tags: readonly OrganizeTag[] }) {
  const dots = dotTags(tags);
  if (dots.length === 0) return null;
  return (
    <span className="tag-dots" data-testid="tag-dots" aria-hidden="true">
      {dots.map((tag) => (
        <i key={tag.id} data-tag-id={tag.id} data-position={tag.position!} style={{ background: tagColorVar(tag.position!) }} />
      ))}
    </span>
  );
}
