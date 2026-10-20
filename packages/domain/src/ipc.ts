import { z } from 'zod';
import type { AppInfo, ImportOutcome, LibraryItem, RecoveryReport } from './library';
import type { Result } from './result';

export const storageModeSchema = z.enum(['managed', 'linked']);
export const pickAndImportInput = z.object({ mode: storageModeSchema, allowDuplicate: z.boolean().default(false) });
export const importPathsInput = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
  mode: storageModeSchema,
  allowDuplicate: z.boolean().default(false),
});
export const itemIdInput = z.object({ itemId: z.uuid() });
export const assetIdInput = z.object({ assetId: z.uuid() });
export const emptyInput = z.object({}).strict().optional();

export type PickAndImportInput = z.input<typeof pickAndImportInput>;
export type ImportPathsInput = z.input<typeof importPathsInput>;

/** The only surface the renderer sees (window.learn). */
export interface LearnApi {
  appInfo(): Promise<Result<AppInfo>>;
  pickAndImport(input: PickAndImportInput): Promise<Result<ImportOutcome[]>>;
  importPaths(input: ImportPathsInput): Promise<Result<ImportOutcome[]>>;
  listItems(): Promise<Result<LibraryItem[]>>;
  getItem(input: { itemId: string }): Promise<Result<LibraryItem>>;
  pickAndRelink(input: { assetId: string }): Promise<Result<LibraryItem | null>>;
  recoveryReport(): Promise<Result<RecoveryReport>>;
  /** Drag & drop: resolves a dropped File to its path via webUtils (sandbox-safe). */
  pathForFile(file: File): string;
}
