import { Clapperboard, FileText, Image, type LucideIcon } from 'lucide-react';
import type { ItemType } from '@learn/domain';

const ICONS: Readonly<Record<ItemType, LucideIcon>> = { pdf: FileText, video: Clapperboard, image: Image };

/** The glyph of an item's kind, wherever an item is listed (table, palette, tabs, drag, panel, trash, duplicates). */
export function itemIcon(type: ItemType): LucideIcon {
  return ICONS[type];
}
