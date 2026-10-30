import { TagChip, type TagChipProps } from '../tags/TagChip';
import { useChipDrag } from './chipDrag';

/** A tag chip that can be dragged onto table rows: the tag selector's and the item panel's chips are this one. */
export function DraggableTagChip(props: TagChipProps) {
  const { dragProps } = useChipDrag(props.tag);
  return <TagChip {...props} dragProps={dragProps as Record<string, unknown>} />;
}
