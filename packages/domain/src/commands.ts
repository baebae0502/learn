/** Single command registry (menus, context menus, shortcuts). No zod: the sandboxed preload imports this. */
export type CommandId = 'file.importManaged' | 'file.importLinked' | 'nav.back' | 'item.open' | 'item.relink';
export type CommandContext = 'library' | 'viewer' | 'item';
export type MenuName = 'file' | 'edit' | 'view' | 'go' | 'window';

export interface CommandSpec {
  id: CommandId;
  /** Korean user-facing label. */
  label: string;
  accelerator?: string;
  menu?: { menu: MenuName; group: number; order: number };
  contexts: CommandContext[];
  contextMenu?: boolean;
}

export const COMMANDS: readonly CommandSpec[] = [
  { id: 'file.importManaged', label: '자료 가져오기…', accelerator: 'CmdOrCtrl+O', menu: { menu: 'file', group: 1, order: 1 }, contexts: ['library'] },
  { id: 'file.importLinked', label: '외부 파일 연결…', accelerator: 'Alt+CmdOrCtrl+O', menu: { menu: 'file', group: 1, order: 2 }, contexts: ['library'] },
  { id: 'nav.back', label: '라이브러리로 돌아가기', accelerator: 'CmdOrCtrl+[', menu: { menu: 'go', group: 1, order: 1 }, contexts: ['viewer'] },
  { id: 'item.open', label: '열기', contexts: ['item'], contextMenu: true },
  { id: 'item.relink', label: '다시 연결…', contexts: ['item'], contextMenu: true },
];

export function commandById(id: CommandId): CommandSpec {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown command: ${id}`);
  return c;
}
