import { ArrowLeft, Command, ExternalLink, FilePlus, FolderOpen, FolderSearch, Keyboard, Link, PanelLeft, Settings, Type, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react';
import type { CommandId } from '@learn/domain';

/** Palette row icons (design-spec 5: lucide 16 / 1.5). Exhaustive: a new command without an icon fails typecheck. */
export const COMMAND_ICONS: Record<CommandId, LucideIcon> = {
  'file.importManaged': FilePlus,
  'file.importLinked': Link,
  'nav.back': ArrowLeft,
  'item.relink': Link,
  'item.open': FolderOpen,
  'item.showInFolder': FolderSearch,
  'item.openExternally': ExternalLink,
  'view.toggleSidebar': PanelLeft,
  'app.shortcuts': Keyboard,
  'app.palette': Command,
  'app.settings': Settings,
  // Full-height glyphs like their neighbours (critic T10-n2: a-arrow-up/down drew 8 px of ink beside 12–14).
  'view.textBigger': ZoomIn,
  'view.textSmaller': ZoomOut,
  'view.textReset': Type,
};
