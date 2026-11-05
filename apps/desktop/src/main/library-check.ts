import type { BrowserWindow } from 'electron';
import {
  CHECK_ROW_KINDS, LearnError, toLearnError,
  type CheckEntry, type CheckFailure, type CheckFix, type CheckMode, type CheckRow, type CheckRowKind, type ImportReport, type LibraryCheck, type LibraryCheckPayload,
  type SheetAction,
} from '@learn/domain';
import type { LibraryRepository } from '@learn/db';
import {
  assetKeyFile, checkLibrary, cleanStaging, cleanUnreferenced, corruptCopies, editedCopyFile, fileTitle, orphanEditedCopies, refreshLinkedAvailability, relinkAsset,
  removeImportedEditedCopy,
} from '@learn/library';
import type { ImportBatch, ImportQueue } from './jobs/import-queue';
import type { LibraryContext } from './library-context';
import { markPerf } from './perf';
import type { ActingSheet, SheetHost } from './sheets';
import { mainStrings } from './strings';

/** The library setting holding the fingerprint of the list the user was shown last (spec 7.1; ADR-0007 rule (b)). */
export const LAST_SHOWN = 'recovery.lastShown';
/** How often the automatic sheet looks again for a clear window (no sheet on it, no job on the line). */
export const AUTO_POLL_MS = 500;
/** P-26: two names, then 외 N개. */
export const ENTRY_NAMES = 2;

export type CheckContext = Pick<LibraryContext, 'layout' | 'repo' | 'importer' | 'settings'> & { check: LibraryCheck | null };

const managedState = (repo: LibraryRepository) => new Map(repo.assetsByMode('managed').map((a) => [a.id, a.availability] as const));
const itemsOf = (repo: LibraryRepository, assetIds: readonly string[]) => [...new Set(assetIds.flatMap((id) => repo.itemIdsForAsset(id)))];

/**
 * One check (spec 7): the linked originals are looked for, then the library folder is read. The items whose file was
 * found missing or back are announced (libraryChanged{availability}) — the linked ones before the folder is read, so the
 * table is right as soon as it can be. The result is the context's newest check.
 */
export async function runCheck(ctx: CheckContext, announce: (itemIds: string[]) => void, opts: { startup?: boolean } = {}): Promise<LibraryCheck> {
  const linked = itemsOf(ctx.repo, await refreshLinkedAvailability(ctx.layout, ctx.repo));
  if (linked.length > 0) announce(linked);
  const before = managedState(ctx.repo);
  const check = await checkLibrary(ctx.layout, ctx.repo, { interruptJobs: opts.startup === true, stagingInUse: ctx.importer.stagingInUse() });
  const moved = [...managedState(ctx.repo)].filter(([id, availability]) => before.get(id) !== availability).map(([id]) => id);
  const managed = itemsOf(ctx.repo, moved);
  if (managed.length > 0) announce(managed);
  ctx.check = check;
  return check;
}

/** Whether the sheet is due by itself: something the app left or lost, and not the list the user was shown last. */
export function autoShowDue(check: LibraryCheck | null, lastShown: unknown): boolean {
  return check !== null && check.actionable && check.fingerprint !== lastShown;
}

/** When the automatic sheet may show (spec 7.1): after the first screen, with no other sheet and no job running. */
export interface AutoGate {
  /** The main window drew its first list and went idle (ui.reportIdle). */
  firstScreen: Promise<void>;
  /** No main window, a sheet or dialog on it, or a job (an import) on the line. */
  busy(): boolean;
  /** A check sheet was shown meanwhile, or the app quits. */
  stopped(): boolean;
  sleep(ms: number): Promise<void>;
}

export async function clearToShow(gate: AutoGate, pollMs = AUTO_POLL_MS): Promise<{ go: boolean; waited: boolean }> {
  await gate.firstScreen;
  let waited = false;
  for (;;) {
    if (gate.stopped()) return { go: false, waited };
    if (!gate.busy()) return { go: true, waited };
    waited = true;
    await gate.sleep(pollMs);
  }
}

export type AutoOutcome = 'requested' | 'not-due' | 'stopped';
export interface StartCheckDeps {
  announce(itemIds: string[]): void;
  /** recovery:show to the main window, which asks for the sheet itself (Q-8d). */
  requestAuto(): void;
  gate: AutoGate;
  pollMs?: number;
}

/**
 * P-18: the startup check, run once the window exists and never awaited by it. Jobs the last run left running are
 * interrupted; then, once the window is clear, the automatic sheet is asked for when it is due. A wait for a running
 * import is followed by a fresh check: the import may have changed what is there.
 */
export async function startLibraryCheck(ctx: CheckContext, deps: StartCheckDeps): Promise<AutoOutcome> {
  markPerf('checkStart');
  let check = await runCheck(ctx, deps.announce, { startup: true });
  markPerf('checkEnd');
  const { go, waited } = await clearToShow(deps.gate, deps.pollMs);
  if (!go) return 'stopped';
  if (waited) check = await runCheck(ctx, deps.announce);
  if (!autoShowDue(check, ctx.settings.get(LAST_SHOWN))) return 'not-due';
  deps.requestAuto();
  return 'requested';
}

/** The list a sheet showed (on opening and after each action): the same list never opens the sheet by itself again (Q-8f). */
function rememberShown(ctx: CheckContext, check: LibraryCheck): void {
  try {
    ctx.settings.set(LAST_SHOWN, check.fingerprint);
  } catch (e) {
    console.warn(`[check] the list shown was not recorded: ${toLearnError(e).code}`);
  }
}

const byTitle = (a: { id: string; title: string }, b: { id: string; title: string }) => a.title.localeCompare(b.title, 'ko') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function itemEntries(repo: LibraryRepository, itemIds: readonly string[], withPath: boolean): CheckEntry[] {
  return repo
    .getItems(itemIds)
    .sort(byTitle)
    .slice(0, ENTRY_NAMES)
    .map((item) => ({ itemId: item.id, label: item.title, path: withPath ? (repo.getAsset(item.assetId)?.externalPath ?? null) : null }));
}

/** A corrupt copy's item, by the sha256 in its name: the title the user knows it by, or nothing. */
function corruptEntries(repo: LibraryRepository, files: readonly string[]): CheckEntry[] {
  const sha = /^corrupt-([0-9a-f]{64})-/.exec(files[0] ?? '')?.[1];
  if (sha === undefined) return [];
  const itemId = repo.findAssetsBySha(sha).flatMap((a) => repo.itemIdsForAsset(a.id))[0];
  const title = itemId === undefined ? undefined : repo.getItem(itemId)?.title;
  return title === undefined ? [] : [{ itemId: null, label: title, path: null }];
}

export interface PayloadInput {
  mode: CheckMode;
  /** What the sheet showed before this check (null on opening). */
  prev: LibraryCheckPayload | null;
  /** The row the action just ran on, and how it fixes it. */
  acted: { kind: CheckRowKind; fix: CheckFix } | null;
  failed: CheckFailure | null;
  homeDir: string;
}

/** The sheet's rows from a check: the ones with something left, and those shown before kept in place as done (P-26). */
export function checkPayload(check: LibraryCheck, repo: LibraryRepository, input: PayloadInput): LibraryCheckPayload {
  const sizes: Record<CheckRowKind, { count: number; bytes: number }> = {
    staging: check.staging,
    unreferenced: { count: check.unreferenced.keys.length, bytes: check.unreferenced.bytes },
    missingManaged: { count: check.missingManaged.itemIds.length, bytes: 0 },
    missingLinked: { count: check.missingLinked.itemIds.length, bytes: 0 },
    corrupt: { count: check.corrupt.count, bytes: check.corrupt.bytes },
    orphanEdits: { count: check.orphanEdits.count, bytes: check.orphanEdits.bytes },
  };
  const entries = (kind: CheckRowKind): CheckEntry[] => {
    if (kind === 'missingManaged') return itemEntries(repo, check.missingManaged.itemIds, false);
    if (kind === 'missingLinked') return itemEntries(repo, check.missingLinked.itemIds, true);
    if (kind === 'corrupt') return corruptEntries(repo, check.corrupt.files);
    if (kind === 'orphanEdits') return check.orphanEdits.copies.slice(0, 1).map((c) => ({ itemId: null, label: c.name, path: null }));
    return [];
  };
  const rows: CheckRow[] = [];
  for (const kind of CHECK_ROW_KINDS) {
    const { count, bytes } = sizes[kind];
    const before = input.prev?.rows.find((r) => r.kind === kind);
    if (count > 0) rows.push({ kind, state: 'todo', count, bytes, entries: entries(kind), fix: null, keys: kind === 'unreferenced' ? check.unreferenced.keys : [] });
    else if (before) {
      const fix: CheckFix = before.state === 'done' ? (before.fix ?? 'none') : input.acted?.kind === kind ? input.acted.fix : 'none';
      rows.push({ kind, state: 'done', count: 0, bytes: 0, entries: [], fix, keys: [] });
    }
  }
  return { kind: 'libraryCheck', mode: input.mode, items: check.items, rows, homeDir: input.homeDir, failed: input.failed };
}

/** A batch put in the queue, answered when its own files are over (not when the run it joined ends). */
export function importAndWait(imports: Pick<ImportQueue, 'enqueue'>, batch: ImportBatch): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      imports.enqueue({ ...batch, onSettled: resolve });
    } catch (e) {
      reject(e);
    }
  });
}

/** An open panel's words (macOS shows a sheet's message, not its title). */
export interface PickWords {
  title: string;
  message: string;
  buttonLabel: string;
}

export interface CheckSheetsDeps {
  /** The open library; throws LIBRARY_UNAVAILABLE when there is none. */
  context(): LibraryContext;
  sheets: Pick<SheetHost, 'open'>;
  imports: Pick<ImportQueue, 'enqueue'>;
  /** libraryChanged{availability} for the items whose file a check found missing or back. */
  announce(itemIds: string[]): void;
  /** libraryChanged{relink} for the items on a file 다시 연결… pointed again. */
  relinked(itemIds: string[]): void;
  homeDir: string;
  /** An open panel on `owner` (the check sheet: a sheet on the sheet on macOS, Q-8g); null when cancelled. */
  pickFile(owner: BrowserWindow, words: PickWords): Promise<string | null>;
  reveal(file: string): void;
  /** A check sheet is shown: the startup's automatic one is not wanted any more. */
  stopAuto(): void;
}

export interface CheckSheets {
  /** library:check — the sheet over `parent`; answers when it has closed. */
  open(parent: BrowserWindow, mode: CheckMode): Promise<void>;
  /** sheet:act for a check sheet: the action, a fresh check, the rows it shows now. */
  act(action: SheetAction, sheet: ActingSheet): Promise<LibraryCheckPayload>;
  /** A fresh check (E2E: the tour asks the automatic sheet again). */
  recheck(): Promise<LibraryCheck>;
}

export function createCheckSheets(deps: CheckSheetsDeps): CheckSheets {
  const words = mainStrings.libraryCheck;
  const owner = (sheet: ActingSheet) => sheet.parent.webContents.id;

  return {
    async open(parent, mode) {
      const ctx = deps.context();
      deps.stopAuto();
      const check = mode === 'auto' ? ctx.check : await runCheck(ctx, deps.announce);
      if (check === null || (mode === 'auto' && !check.actionable)) return;
      rememberShown(ctx, check);
      await deps.sheets.open(parent, checkPayload(check, ctx.repo, { mode, prev: null, acted: null, failed: null, homeDir: deps.homeDir }));
    },

    async act(action, sheet) {
      const prev = sheet.payload;
      if (action.kind !== 'libraryCheck' || prev.kind !== 'libraryCheck') throw new LearnError('VALIDATION_FAILED', mainStrings.badRequest);
      const ctx = deps.context();
      let acted: PayloadInput['acted'] = null;
      let failed: CheckFailure | null = null;
      /** What is left of the files the action took, said under its row once the check is fresh. */
      let left: ((check: LibraryCheck) => CheckFailure | null) | null = null;

      switch (action.act) {
        case 'cleanStaging': {
          const r = await cleanStaging(ctx.layout, ctx.importer.stagingInUse());
          acted = { kind: 'staging', fix: 'cleaned' };
          if (r.failed > 0) failed = { kind: 'staging', message: words.stagingLeft(r.failed) };
          break;
        }
        case 'cleanUnreferenced': {
          // Only what the row listed when the user was asked, and what is still unused now: a copy that came later waits (as emptyTrash).
          const asked = new Set(action.keys);
          const keys = (await runCheck(ctx, deps.announce)).unreferenced.keys.filter((k) => asked.has(k));
          const r = await cleanUnreferenced(ctx.layout, (key) => ctx.repo.managedPathInUse(key), keys);
          acted = { kind: 'unreferenced', fix: 'cleaned' };
          if (r.failed > 0) failed = { kind: 'unreferenced', message: words.unreferencedLeft(r.failed) };
          break;
        }
        case 'revive': {
          const { keys } = (await runCheck(ctx, deps.announce)).unreferenced;
          const paths = keys.flatMap((key) => assetKeyFile(ctx.layout, key) ?? []);
          // A copy of known bytes is a new item of its own (no duplicate question can wait behind this open sheet, Q-8j).
          if (paths.length > 0) {
            await importAndWait(deps.imports, {
              paths, mode: 'managed', collectionId: null, owner: owner(sheet), allowDuplicate: true,
              titles: Object.fromEntries(paths.map((p) => [p, words.revivedTitle])),
            });
          }
          acted = { kind: 'unreferenced', fix: 'revived' };
          left = (check) => {
            const n = check.unreferenced.keys.filter((k) => keys.includes(k)).length;
            return n > 0 ? { kind: 'unreferenced', message: words.notRevived(n) } : null;
          };
          break;
        }
        case 'relink': {
          const item = ctx.repo.getItem(action.itemId);
          const asset = item ? ctx.repo.getAsset(item.assetId) : undefined;
          if (!item || !asset) throw new LearnError('NOT_FOUND', mainStrings.itemFile.noItem);
          const linked = asset.storageMode === 'linked';
          const picked = await deps.pickFile(sheet.window, {
            title: mainStrings.openPanels.relink,
            message: linked ? mainStrings.openPanels.relinkMessage : words.restoreMessage,
            buttonLabel: mainStrings.openPanels.relinkButton,
          });
          if (picked === null) return prev;
          if (linked) await relinkAsset(ctx.repo, asset.id, picked);
          else await ctx.importer.restoreCopy(picked, asset.id);
          deps.relinked(ctx.repo.itemIdsForAsset(asset.id));
          acted = { kind: linked ? 'missingLinked' : 'missingManaged', fix: 'relinked' };
          break;
        }
        case 'revealCorrupt': {
          const [file] = await corruptCopies(ctx.layout);
          if (file === undefined) throw new LearnError('NOT_FOUND', words.gone);
          deps.reveal(file);
          return prev;
        }
        case 'revealOrphanEdit':
        case 'importOrphanEdits': {
          const live = new Set(ctx.repo.allAssets().map((a) => a.id));
          const files: string[] = [];
          for (const c of await orphanEditedCopies(ctx.layout, live)) {
            const file = await editedCopyFile(ctx.layout, c.assetId, c.name);
            if (file !== null) files.push(file);
          }
          if (action.act === 'revealOrphanEdit') {
            if (files[0] === undefined) throw new LearnError('NOT_FOUND', words.gone);
            deps.reveal(files[0]);
            return prev;
          }
          if (files.length > 0) {
            await importAndWait(deps.imports, {
              paths: files, mode: 'managed', collectionId: null, owner: owner(sheet), allowDuplicate: true,
              titles: Object.fromEntries(files.map((f) => [f, fileTitle(f)])),
              // The only edited copy the app removes: once its import committed and its bytes are the library's (spec 6, 16).
              afterCommit: async (outcome) => {
                await removeImportedEditedCopy(ctx.layout, outcome.path, ctx.repo.getAsset(outcome.item.assetId));
              },
            });
          }
          acted = { kind: 'orphanEdits', fix: 'imported' };
          left = (check) => (check.orphanEdits.count > 0 ? { kind: 'orphanEdits', message: words.notImported(check.orphanEdits.count) } : null);
          break;
        }
      }

      const check = await runCheck(ctx, deps.announce);
      rememberShown(ctx, check);
      return checkPayload(check, ctx.repo, { mode: prev.mode, prev, acted, failed: left?.(check) ?? failed, homeDir: deps.homeDir });
    },

    recheck: () => runCheck(deps.context(), deps.announce),
  };
}
