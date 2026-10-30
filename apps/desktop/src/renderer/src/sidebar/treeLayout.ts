import { ListLayout } from 'react-aria-components';

/**
 * The height of a section of the tree from the kinds of the nodes in it (the flattened list of its heading and open rows). A row
 * has `rowSize`, the heading `headingSize`; the content node every open row also has in that list takes no room.
 */
export function sectionHeight(kinds: Iterable<string>, rowSize: number, headingSize: number): number {
  let height = 0;
  for (const kind of kinds) {
    if (kind === 'item') height += rowSize;
    else if (kind === 'header') height += headingSize;
  }
  return height;
}

interface SectionNode {
  key: string | number;
  type: string;
}

/**
 * React Aria's ListLayout for a Tree in sections. For the rows below the visible window it estimates a section's height as
 * rows × row size, and counts in the rows the content node of each open row — a node of no height that the layout skips when it
 * places rows. A tree with open rows is then taller than its rows by one row per open row (28 open rows: 784 px, so the end of
 * the list was blank). With fixed sizes the height is known exactly, so it is set from the list itself.
 */
export class TreeSectionsLayout extends ListLayout<object> {
  protected override buildSection(node: SectionNode, x: number, y: number) {
    const built = super.buildSection(node as never, x, y);
    const children = this.collection.getChildren?.(node.key);
    if (this.rowSize !== null && this.headingSize !== null && this.orientation === 'vertical' && children) {
      const kinds = [...children].map((child) => child.type);
      built.layoutInfo.rect.height = sectionHeight(kinds, this.rowSize + this.gap, this.headingSize + this.gap) - (kinds.length > 0 ? this.gap : 0);
    }
    return built;
  }
}
