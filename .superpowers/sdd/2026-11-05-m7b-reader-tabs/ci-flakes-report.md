# CI flakes — report (BASE 55008c4)

Load used: `taskset -c 0` (and `-c 0-1`, `-c 0-3`) under xvfb-run; for view-modes and dnd also 3 and 5 busy loops pinned to core 0.

## 1. view-modes "horizontal: … → turns a page" — NOT reproduced; hardened
- Probe (a temporary spec, removed) logged focusin/keydown with timestamps over 12 menu closes at `-c 0` + 3 hogs. Result: after Escape the menu keeps the focus 200-300 ms under load, then either the stage (test's `focus()`) or the trigger (React Aria's restore) gets it; in 1 of 12 the trigger got it and the stage 34 ms later. The stage never lost the focus to the trigger afterwards. In @react-aria/focus (FocusScope.mjs, useRestoreFocus cleanup) the restore runs in a rAF and only `if document.activeElement === document.body`, so a late restore cannot steal from a stage that already has the focus. The controller's reading (late restore lands after `stage.focus()`) is therefore NOT supported by the library code or by the probe.
- Original test: 10/10 green at `-c 0` and 6/6 with 3 hogs. I could not make it fail.
- Fix (defensive, no app change): after Escape wait for no `role=menu`, then for the trigger to have the focus (the restore has happened), then `stage.focus()` and assert the stage is focused before the arrow. After: 10/10 at `-c 0` with 3 hogs.
- Real-user question: a click into the stage right after closing a menu is not stolen from (the restore only fires when the focus is on body), so no app change.
- The CI cause is still unproven; if it recurs, the new `toBeFocused()` lines will say which step failed.

## 2. view-modes "the submenu stands level" — cause found
- `.menu-popover[data-entering]` runs `pop-in`: `translate: 0 -4px` -> 0 (base.css). The parent popover and the submenu enter at different moments, so a read right after `toBeVisible()` sees them at different phases: the row-to-item offset is anywhere in 0..4 px (CI: 1.18, then 3.31). 55008c4's 2 px tolerance was the wrong fix.
- Fix: poll until every animation under `.menu-popover` has finished (`getAnimations().finished`, no `data-entering/exiting` left), then read; the original tolerance (<= 1 px, overlap 0..2) is back. Also wait for `role=menu` count 0 after the closing Escapes so the next menu does not open over an exiting one.
- Not reproducible here (animation is short; original test 10/10 at `-c 0`, + hogs), so no red-before count; the mechanism is from the CSS and the two CI numbers. After: 10/10 at `-c 0` with 3 hogs.

## 3. view-modes "a page at a time … restored" — left as is; 10/10 at `-c 0` with 3 hogs.

## 4. dnd (i) keyboard drop far from the viewed row — NOT reproduced; no change
- `-c 0` + 3 hogs: 10/10 (22.8 min); `-c 0` + 5 hogs: 6/6 (21.6 min); one try with 8 hogs timed out in the file's beforeAll (120 s), which is load, not the race. Full suite at `-c 0-3`: green.
- Reading: the failure names a row (2de6…) that is in neither `__others` nor `__late`, so it is a focus/selection move by React Aria itself after the guard (`awaitLateMoves` in dragState.ts) was released. The guard releases after `rAF -> runAfterTransition(release)`, and `runAfterTransition` waits for every running transition in the document, including the test's own `fading` element (150 ms), so on a slow runner the release can fall before or after the test's third injected focus. That is a hypothesis; I have no evidence that it is the cause and I did not change the app. Recommend capturing a trace on the next CI failure (the test already logs the focus log) rather than changing drops/dragState blind.

## 5. Same patterns elsewhere
- Looked at the M7b specs (tabs, history, view-modes, keyboard M7b tests, reader-pdf M7b tests, inspector 읽기 tests): menu open then geometry — only the submenu test reads geometry (fixed); a11y checks right after a menu opens are safe (color-contrast is off, so the fade does not matter); relaunch decisions — view-modes `reader()` already waits; tabs relaunch tests assert with auto-waiting matchers. reader-pdf's zoom-menu left-alignment reads x only (pop-in moves y only). No further races found in M7b specs.

## 6. Full suite under `taskset -c 0-3 pnpm e2e:xvfb` (at 007300c)
- 534 passed, 4 skipped, 1 failed: `import-queue.spec.ts:272` "the empty library's busy screen counts the queue: 2 becomes 3 …" — `item-row` count 0 for 15 s after `importResume`.
- Cause: `importResume()` is a no-op when the file has not reached its hold yet (test-hooks.ts `createImportPause.resume`: `release` is null), and the file then waits for good. The busy-screen heading "3개를 가져오는 중" is drawn from the queue's count, long before the file is at `beforeCommit`. Same bug as Mac all 41387123318 failure 2 (fixed there with an explicit wait in another test).
- Reproduced: `-c 0-1`, `--repeat-each=10` before: 10/10 red; after: 10/10 green.
- Fix: the `importResume` helper polls `importWaiting()` until a file is held (15 s, then resumes anyway), so every caller is covered (about 20 call sites, 8 of them with no wait of their own).
- Re-run of every spec that calls `importResume` at `-c 0-3` after the fix: see the end of this file.
- No M7b test failed in the full run (view-modes, tabs, history, keyboard, reader-pdf, inspector, dnd all green).

## typecheck / unit
- `pnpm typecheck` clean, `pnpm test`: 284 files passed, 2517 tests passed, 1 skipped.
- Re-run at `-c 0-3` of import-queue, edited-copy, commands-coverage, library, backup, restore specs (37 tests, all call importResume): 37 passed.
