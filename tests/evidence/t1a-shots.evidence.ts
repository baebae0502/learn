// @t1a — the T1a tutor's states in light and dark on macOS, for the design critique's light and dark frames (T1a spec 1): a window
// shot of each (screencapture: the traffic lights, the sidebar's vibrancy, the window as a Mac shows it). Linux runs the file too and
// takes the page instead. The states are staged with the fake agent as the tour's T1a scenes stage them (tests/e2e/visual/tour.spec.ts),
// without its baselines: the PDF is drawn, the clock is the real one.
//
// The pictures are taken in the window the display gives, as the other evidence specs take theirs: 1024 × 684 on the macOS runner, where
// the tutor is narrowed. Each description gives the window, the tutor's width, and what of the state the window cannot hold in view. The
// narrow windows come last, sized within the display. A group of states shares a launch, and a group that fails leaves the others'
// pictures. A picture waits for a settled frame: no caret, the pointer parked where nothing hovers, no tooltip, no toast from a step
// before, the fonts loaded and every animation that ends ended.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { LibraryItem } from '../../packages/domain/src/library';
import {
  FIXTURES, backFromReader, displayRoom, importPaths, launch, mainWindow, openItem, runMenuAccelerator, seedSessions, textExtraction, textIdle, tutorFakeScript, tutorNetwork, type Session,
} from '../e2e/helpers';
import { READER_100, askViaApi, attachPassage, consentAndChoose, holdAnswerAfter, turnEnded } from '../e2e/tutor-helpers';
import { layout } from '../../apps/desktop/src/renderer/src/design/tokens';
import { READER_CONTENT_MIN } from '../../apps/desktop/src/renderer/src/shell/layout';
import { IS_MAC, focusApp, movePointer, nativeWindowShot, pageShot, record } from './capture';

const TAG = { tag: '@t1a' };
const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const LONG_OUTLINE = path.join(FIXTURES, 'long-outline.pdf');
type Theme = 'light' | 'dark';
const THEMES: readonly Theme[] = ['light', 'dark'];
/** Under this the tutor's narrowest (320) no longer fits beside the sidebar and the reader's least: it folds. */
const TUTOR_FOLDS_UNDER = layout.sidebarWidth + layout.tutorMin + READER_CONTENT_MIN;
/** The narrowed window: the macOS runner's display width. */
const NARROW_WIDTH = 1024;
/** The folded window: the window's least width, under 980. */
const FOLDED_WIDTH = layout.windowMinWidth;
/** While a picture is taken: screencapture draws the caret wherever its blink is (a page shot hides it itself). */
const NO_CARET = '*, *::before, *::after { caret-color: transparent !important; }';

interface T1aSession extends Session {
  /** paper-100's id. */
  itemId: string;
  /** Every item imported, in the order given (paper-100 first). */
  items: LibraryItem[];
  dir: string;
}

/**
 * A window in the size the display gives it, paper-100 imported (its body read, which the tutor's page reads use) and open with the
 * reader's right panel on 튜터, its default; `consent`: the fake agent chosen, an empty session. The page follows the theme pref through
 * nativeTheme (no emulation), as on a user's Mac.
 */
async function launchT1a(opts: { consent: boolean; also?: string[] }): Promise<T1aSession> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-t1a-shots-'));
  let s: Session;
  try {
    s = await launch(path.join(dir, 'library'), path.join(dir, 'userdata'), { env: { LEARN_E2E_SETTINGS: '', TZ: 'Asia/Seoul' }, colorScheme: null });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const t: T1aSession = Object.assign(s, { dir, itemId: '', items: [] });
  try {
    t.items = await importPaths(t.page, [PAPER, ...(opts.also ?? [])]);
    t.itemId = t.items[0]!.id;
    await textExtraction(t.app, 'now');
    await textIdle(t.app);
    await openItem(t.page, 'paper-100');
    await expect(t.page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]/);
    if (IS_MAC) {
      await focusApp(t.app);
      // The real pointer on the spot the other suites park it on, so a later activation of the window hovers nothing it left.
      await movePointer(512, 620);
    }
    if (opts.consent) {
      await consentAndChoose(t.page, 'fake');
      await expect(t.page.getByTestId('tutor-empty')).toBeVisible();
    }
    return t;
  } catch (e) {
    await closeT1a(t);
    throw e;
  }
}

async function closeT1a(s: T1aSession): Promise<void> {
  await s.app.close().catch(() => {});
  fs.rmSync(s.dir, { recursive: true, force: true });
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.learn.prefs.set({ theme: t }), theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
}

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const tutorInput = (page: Page) => page.getByTestId('tutor-input');

/** The pointer (Playwright's, which is the page's hover) in the window's bottom-right corner, over nothing that hovers. */
async function park(page: Page): Promise<void> {
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(w - 1, h - 1);
}

/**
 * macOS: the app in front, so the traffic lights are in their active colours. Before the pointer is parked and before keys: a window
 * made active may get a mouse-moved event from the real pointer.
 */
async function front(s: Session): Promise<void> {
  if (IS_MAC) await focusApp(s.app);
}

/**
 * The fonts loaded, every running animation that ends ended (a toast's rise, a chip's ring fading), then two frames painted. An
 * animation that has not ended after 3 s is not waited for longer.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const ending = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
    await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))]);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

/** The conversation column scrolled to its top (the session's head line, the first question), or `target` brought to its middle. */
async function logTo(page: Page, target?: Locator): Promise<void> {
  if (target === undefined) await page.getByTestId('tutor-log').evaluate((el) => void (el.scrollTop = 0));
  else await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** A question typed into the composer and sent with ↩ (the focus there starts the agent first). */
async function sendQuestion(page: Page, text: string): Promise<void> {
  await tutorInput(page).focus();
  await page.keyboard.insertText(text);
  await expect(tutorInput(page)).toHaveValue(text);
  await page.keyboard.press('Enter');
}

/** What a state is about, by name: each must be wholly in view (inside the window and every box that clips it), or the description says so. */
type Subject = readonly [string, Locator];

/** Whether every element `loc` matches is inside the window and inside each ancestor that clips it (a scrolled column cuts it). */
const inView = (loc: Locator): Promise<boolean> =>
  loc.evaluateAll((els) =>
    els.length > 0 &&
    els.every((el) => {
      const r = el.getBoundingClientRect();
      let box = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = a.getBoundingClientRect();
        box = { top: Math.max(box.top, b.top), left: Math.max(box.left, b.left), bottom: Math.min(box.bottom, b.bottom), right: Math.min(box.right, b.right) };
      }
      return r.top >= box.top - 1 && r.left >= box.left - 1 && r.bottom <= box.bottom + 1 && r.right <= box.right + 1;
    }),
  );

/** The window and the panes as the picture has them, and the subjects the window cannot hold in view. */
async function where(page: Page, subjects: readonly Subject[]): Promise<string> {
  const v = await page.evaluate(() => {
    const shown = (id: string) => document.querySelector(`[data-testid="${id}"]:not([data-active="false"] *)`);
    const shell = shown('shell');
    return {
      w: innerWidth,
      h: innerHeight,
      inspector: shell?.getAttribute('data-inspector') ?? null,
      sidebar: shell?.getAttribute('data-sidebar') ?? null,
      mode: shown('inspector')?.getAttribute('data-mode') ?? null,
      panel: Math.round(shown('inspector-panel')?.getBoundingClientRect().width ?? 0),
    };
  });
  const parts = [`window ${v.w}×${v.h}`];
  if (v.mode === 'tutor' && v.inspector === 'shown') parts.push(v.panel < layout.tutorWidth ? `tutor ${v.panel} px, narrowed from its ${layout.tutorWidth} by the window` : `tutor ${v.panel} px`);
  if (v.mode === 'tutor' && v.inspector === 'hidden') parts.push('tutor folded');
  if (v.sidebar === 'hidden') parts.push('sidebar folded');
  const cut: string[] = [];
  for (const [name, loc] of subjects) if (!(await inView(loc))) cut.push(name);
  if (cut.length > 0) parts.push(`not wholly in view at this window: ${cut.join(', ')}`);
  return parts.join('; ');
}

interface Shot {
  /** t1a-<name>-<theme>. */
  name: string;
  what: string;
  subjects: readonly Subject[];
  /** false: the caller brought the app to the front before staging (a toast's 5 s, keys whose ring a later activation could change). */
  front?: boolean;
  /** false: the caller parked the pointer before the keys (a pointer move after them makes the modality the pointer's: no ring). */
  park?: boolean;
  /** The state is a toast. */
  toast?: boolean;
}

/**
 * The state on screen, settled, in pictures: on macOS the window (screencapture; a failed one is a soft failure) and then the page, as
 * the other suites take both; elsewhere the page. The state itself is the caller's to have checked.
 */
async function shoot(s: Session, theme: Theme, shot: Shot): Promise<void> {
  const { app, page } = s;
  if (shot.toast !== true) await expect(page.locator('[data-pane="toasts"] .toast'), 'no toast left from a step before').toHaveCount(0, { timeout: 12_000 });
  if (shot.front !== false) await front(s);
  if (shot.park !== false) await park(page);
  await expect(page.getByRole('tooltip'), 'no tooltip in the picture').toHaveCount(0);
  const name = `t1a-${shot.name}-${theme}`;
  const style = await page.addStyleTag({ content: NO_CARET });
  try {
    await settle(page);
    const description = `T1a ${shot.what} — ${theme}; ${await where(page, shot.subjects)}`;
    if (IS_MAC) {
      const entry = await nativeWindowShot(app, name, description, { focus: false });
      expect.soft(entry.file, `${name}: the window shot (${entry.error ?? 'no error'})`).not.toBeNull();
    }
    await pageShot(page, name, description);
  } finally {
    await style.evaluate((el) => (el as Element).remove());
  }
}

/** The state in light, then in dark; `check` holds before each picture (the state is still there after the theme changed). */
async function shootBoth(s: Session, shot: Shot, check: () => Promise<void> = async () => {}): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(s.page, theme);
    await check();
    await shoot(s, theme, shot);
  }
}

test('T1a 1–3: the consent card, the chooser with the fake agent chosen, the empty session it starts', TAG, async () => {
  const s = await launchT1a({ consent: false });
  const { page } = s;
  try {
    await expect(page.getByTestId('tutor-consent')).toBeVisible();
    await shootBoth(s, { name: 'consent', what: '1 the consent card, the tutor shown for the first time', subjects: [['the card', page.getByTestId('tutor-consent')]] });

    // 동의: the chooser reads the agents (E2E searches an empty folder, so Claude Code is as this runner's E2E build finds it); the
    // fake of a development build is chosen.
    await page.getByTestId('tutor-consent-agree').click();
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    const claudeFlag = page.getByTestId('agent-row').and(page.locator('[data-agent="claude"]')).getByTestId('agent-flag');
    await expect(claudeFlag).toHaveText(/\S/);
    await expect(page.getByTestId('agent-searching')).toHaveCount(0);
    await page.getByTestId('agent-dev-group').getByTestId('agent-row').click();
    await expect(page.getByTestId('agent-dev-group').getByRole('radio')).toBeChecked();
    await expect(page.getByTestId('agent-start')).toHaveText('가짜 에이전트로 시작');
    await blur(page);
    const claude = (await claudeFlag.textContent())?.trim() ?? '';
    await shootBoth(s, {
      name: 'chooser',
      what: `2 the chooser, the fake agent chosen, Claude Code ${claude}`,
      subjects: [['the agents', page.getByTestId('agent-row')], ['시작', page.getByTestId('agent-start')]],
    });

    // 시작: a new empty session under the fake's band.
    await page.getByTestId('agent-start').click();
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expect(page.getByTestId('tutor-fake-band')).toBeVisible();
    await shootBoth(s, {
      name: 'empty',
      what: '3 an empty session, the fake agent\'s band and the empty-state text',
      subjects: [['the band', page.getByTestId('tutor-fake-band')], ['the empty-state text', page.getByTestId('tutor-empty')]],
    });
  } finally {
    await closeT1a(s);
  }
});

test('T1a 4–6: a passage attached, an answer coming, the answer with a cite chip pressed', TAG, async () => {
  const s = await launchT1a({ consent: true });
  const { app, page } = s;
  try {
    // A passage of page 1: its chip in the composer, its mark on the page, a question typed.
    await attachPassage(page);
    await tutorInput(page).focus();
    await page.keyboard.insertText('이 문장은 어떤 구조를 말하나요?');
    const mark = page.locator('.pdfViewer .page[data-page-number="1"] [data-testid="pdf-attached"] .attached');
    await shootBoth(s, {
      name: 'attached',
      what: '4 a passage attached, its chip in the composer and its mark on page 1, a question typed',
      subjects: [['the chip', page.getByTestId('tutor-attached')], ['the mark on the page', mark]],
    });

    // ↩: the answer held as it comes, its tool chips above it (the tour's way of holding the stream). Held at its third text notice, not
    // the tour's twelfth: the chips, the question and the answer's start then fit in the macOS runner's 684 px high window.
    const hold = await holdAnswerAfter(app, 3);
    await tutorInput(page).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => hold.held(), { timeout: 30_000 }).toBe(true);
    const answer = page.getByTestId('tutor-answer');
    const streaming = async () => {
      await expect(answer).toHaveAttribute('data-status', 'streaming');
      await expect(answer.getByTestId('tool-chip')).toHaveText(['선택한 구간 확인', '목차 확인', '1–2쪽 읽음']);
      await expect(page.getByTestId('tutor-stop')).toBeVisible();
    };
    await streaming();
    await shootBoth(
      s,
      {
        name: 'streaming',
        what: '5 an answer coming, its tool chips and the text so far, 중지',
        subjects: [['the tool chips', answer.getByTestId('tool-chip')], ['the text so far', answer.getByTestId('tutor-answer-text')], ['중지', page.getByTestId('tutor-stop')]],
      },
      streaming,
    );
    await hold.release();
    await expect(answer).toHaveAttribute('data-status', 'complete');
    const chips = answer.getByTestId('cite-chip');
    await expect(chips).toHaveText(['1쪽', '2쪽']);

    // The answer with its verified chips, the column at its top; 2쪽 pressed: the reader on page 2, that chip the current one.
    await blur(page);
    await logTo(page);
    await chips.nth(1).click();
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('2');
    const current = async () => {
      await expect(chips.nth(1)).toHaveClass(/\bis-current\b/);
      await expect(chips.nth(0)).not.toHaveClass(/\bis-current\b/);
    };
    await current();
    await blur(page);
    await shootBoth(
      s,
      {
        name: 'answer',
        what: '6 the answer with its verified cite chips, 2쪽 pressed and current, the reader on page 2 (its ring may have faded)',
        subjects: [['the cite chips', chips], ['the question with its passage', page.getByTestId('tutor-question')]],
      },
      current,
    );
  } finally {
    await closeT1a(s);
  }
});

test('T1a 7–8: cites it did not read, the notice and 원문 근거로 다시 묻기; offline, the question kept in the composer', TAG, async () => {
  const s = await launchT1a({ consent: true });
  const { app, page } = s;
  try {
    // An answer that cites the attached page without reading it (it read the two after it) and one past the end.
    await tutorFakeScript(app, 'unverified');
    await attachPassage(page);
    await sendQuestion(page, '이 문장은 무슨 뜻인가요?');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', 'complete');
    const chips = answer.getByTestId('cite-chip');
    await expect(chips).toHaveText(['2쪽', '3쪽', '출처 없음', '출처 없음']);
    await expect(page.getByTestId('tutor-reground')).toBeVisible();
    await blur(page);
    await logTo(page);
    await shootBoth(s, {
      name: 'unverified',
      what: '7 cites it did not read: two verified chips and two 출처 없음, the column at its top',
      subjects: [['the cite chips', chips]],
    });
    await logTo(page, page.getByTestId('tutor-reground'));
    await shootBoth(s, {
      name: 'unverified-notice',
      what: '7 the notice under that answer with 원문 근거로 다시 묻기',
      subjects: [['the notice', page.getByTestId('tutor-unverified')], ['원문 근거로 다시 묻기', page.getByTestId('tutor-reground')]],
    });

    // Offline, in a new session: nothing is sent, the failure says so and the question is back in the composer.
    await page.getByTestId('tutor-new-session').click();
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await tutorNetwork(app, 'offline');
    await sendQuestion(page, '연결이 없을 때 묻습니다.');
    const failure = page.getByTestId('tutor-failure');
    await expect(failure).toHaveAttribute('data-code', 'OFFLINE');
    await expect(tutorInput(page)).toHaveValue('연결이 없을 때 묻습니다.');
    await shootBoth(s, {
      name: 'offline',
      what: '8 a failure: offline, the question kept in the composer',
      subjects: [['the failure', failure], ['the composer', tutorInput(page)]],
    });
    await tutorNetwork(app, null);
  } finally {
    await closeT1a(s);
  }
});

test('T1a 9–11: the 세션 pane by day and a row named in place, the undo toast after ⌘⌫ on a row, the library\'s 세션 section', TAG, async () => {
  const s = await launchT1a({ consent: true, also: [LONG_OUTLINE] });
  const { app, page, itemId } = s;
  const row = (id: string) => page.locator(`[data-testid="session-row"][data-conversation-id="${id}"]`);
  try {
    await runMenuAccelerator(app, 'reader.showSessions');
    await expect(page.getByTestId('reader-sessions-empty')).toBeVisible();
    // Sessions of three days: two of 2026. 10. 12., one of yesterday, and today's, asked now and shown by the tab. The dates come from the
    // page, which runs in the app's time zone (this process may not).
    const [yesterday, october] = await page.evaluate(() => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      y.setHours(16, 52, 0, 0);
      return [y.toISOString(), new Date(2026, 9, 12, 9, 0).toISOString()];
    });
    await seedSessions(app, { itemId, sessions: 2, messagesPerSession: 2, citationsPerAnswer: 1, startedAt: october!, questions: ['그림 6-2는 어떻게 읽나요?', '연습 문제 3번 풀이가 맞는지 봐 주세요'] });
    const [older] = (await seedSessions(app, { itemId, sessions: 1, messagesPerSession: 2, citationsPerAnswer: 1, startedAt: yesterday!, questions: ['6.3절을 다섯 줄로 요약해 주세요'] })).conversationIds;
    const asked = await askViaApi(page, { itemId, conversationId: null, text: '‘각 단계 배율의 곱’이 무슨 뜻인가요?', selection: null, reader: { ...READER_100, pageIndex: 40 } });
    if ('busyWith' in asked) throw new Error('the question waited for another answer');
    await turnEnded(page, asked.conversationId, asked.tutorMessageId);
    const groups = page.getByTestId('reader-sessions').getByTestId('session-group');
    await expect(groups).toHaveCount(3);
    await row(asked.conversationId).click();
    await expect(row(asked.conversationId)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    await blur(page);
    await logTo(page);
    await shootBoth(s, {
      name: 'sessions-days',
      what: '9 the reader\'s 세션 pane by day (오늘, 어제, 2026. 10. 12.), today\'s row the tab\'s session',
      subjects: [['the day groups', groups]],
    });

    // ↩ on a row names it in place. The app in front and the pointer parked before the keys, so the field keeps its keyboard ring.
    const nameField = page.getByTestId('session-name-input');
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await front(s);
      await park(page);
      await row(asked.conversationId).focus();
      await page.keyboard.press('Enter');
      await expect(nameField).toBeFocused();
      await shoot(s, theme, { name: 'sessions-rename', what: '9 a session row\'s name field open, its name selected', subjects: [['the name field', nameField]], front: false, park: false });
      await page.keyboard.press('Escape');
      await expect(nameField).toHaveCount(0);
    }

    // ⌘⌫ on yesterday's row while the tutor shows today's session: the undo toast beside the tutor. It closes 5 s after it first paints,
    // so the app is in front before the delete and the picture is taken at once; the row comes back through the API afterwards.
    const toast = page.getByTestId('session-undo');
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await front(s);
      await row(older!).focus();
      await runMenuAccelerator(app, 'item.trash');
      await expect(toast).toContainText('세션을 삭제했습니다');
      await expect(row(older!)).toHaveCount(0);
      // The focus that went to the next row would bring its tooltip to the picture.
      await blur(page);
      await shoot(s, theme, { name: 'undo-toast', what: '10 the undo toast beside the tutor after ⌘⌫ on a session row', subjects: [['the toast', toast]], front: false, toast: true });
      expect.soft(await toast.isVisible(), `t1a-undo-toast-${theme}: the toast was still up when its picture had been taken`).toBe(true);
      await expect(toast).toHaveCount(0, { timeout: 12_000 });
      expect(await page.evaluate((id) => window.learn.sessions.restore({ conversationId: id }), older!)).toMatchObject({ ok: true });
      await expect(row(older!)).toHaveCount(1);
    }

    // The library's 세션 section: the items talked about last, each with its newest sessions.
    await seedSessions(app, { itemId: s.items[1]!.id, sessions: 2, messagesPerSession: 2, citationsPerAnswer: 1, questions: ['초록을 한국어로 정리해 주세요', '그림 3은 무엇을 보여 주나요?'] });
    await backFromReader(page);
    const section = page.getByTestId('library-sessions');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('session-row')).toHaveCount(5); // paper-100's newest three, long-outline's two
    await shootBoth(s, { name: 'library-sessions', what: '11 the library sidebar\'s 세션 section', subjects: [['the section', section]] });
  } finally {
    await closeT1a(s);
  }
});

test('T1a 12: the narrow windows within the display — the tutor narrowed, then folded', TAG, async () => {
  const s = await launchT1a({ consent: true });
  const { app, page, itemId } = s;
  const shell = (attr: 'data-sidebar' | 'data-inspector') => page.getByTestId('shell').getAttribute(attr);
  const tutorWidth = async () => Math.round((await page.getByTestId('inspector-panel').boundingBox())?.width ?? 0);
  try {
    const asked = await askViaApi(page, { itemId, conversationId: null, text: '이 장은 무엇을 다루나요?', selection: null, reader: { ...READER_100, pageIndex: 40 } });
    if ('busyWith' in asked) throw new Error('the question waited for another answer');
    await turnEnded(page, asked.conversationId, asked.tutorMessageId);
    await expect(page.getByTestId('tutor-answer').getByTestId('cite-chip')).toHaveText(['41쪽', '42쪽']);

    // Only widths the display holds (macOS fits a window's height to the display, and its width only at a restart); the height is
    // the one the display gave the window.
    const room = await displayRoom(app);
    const win = await mainWindow(app);
    const height = await win.evaluate((w) => w.getContentSize()[1]!);
    const size = async (width: number) => {
      await win.evaluate((w, [width, height]) => w.setContentSize(width!, height!), [width, height] as const);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    };
    const skipped = (name: string, why: string) => {
      for (const theme of THEMES) record({ file: null, kind: IS_MAC ? 'window' : 'page', description: `T1a 12 ${name} — ${theme}`, skipped: why });
    };

    const narrow = Math.min(NARROW_WIDTH, room.width);
    if (narrow >= TUTOR_FOLDS_UNDER) {
      await size(narrow);
      await expect.poll(() => shell('data-inspector')).toBe('shown');
      expect(await shell('data-sidebar')).toBe('shown');
      await expect.poll(tutorWidth).toBe(narrow - layout.sidebarWidth - READER_CONTENT_MIN);
      await logTo(page);
      await shootBoth(s, {
        name: 'narrow',
        what: `12 the tutor narrowed in a ${narrow} wide window, beside the sidebar and the reader at its least`,
        subjects: [['the cite chips', page.getByTestId('cite-chip')]],
      });
    } else skipped('the tutor narrowed', `the display leaves the window ${room.width} px, under the ${TUTOR_FOLDS_UNDER} the narrowed tutor needs`);

    if (room.width >= FOLDED_WIDTH) {
      await size(FOLDED_WIDTH);
      await expect.poll(() => shell('data-inspector')).toBe('hidden');
      expect(await shell('data-sidebar')).toBe('shown');
      await shootBoth(s, { name: 'folded', what: `12 the tutor folded in a ${FOLDED_WIDTH} wide window (the window's least), the sidebar kept`, subjects: [['the reader\'s toolbar', page.getByTestId('reader-toolbar')]] });
    } else skipped('the tutor folded', `the display leaves the window ${room.width} px, under its least width ${FOLDED_WIDTH}`);
  } finally {
    await closeT1a(s);
  }
});
