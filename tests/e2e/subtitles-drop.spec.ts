// Subtitle files dropped on a video tab (M8a spec 5.3), through the second drop gate; and in a library drop, the summary that names
// subtitles and the import toast that counts them (5.2, 12). Drags are synthetic (helpers' `drag`): the names are hidden while a real drag
// is over the window, so the tuples below are what the OS reports, and the real files of #drop-source carry the paths of the drop.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, drag, dropSource, importPaths, launch, openItem, videoReady } from './helpers';

const fixture = (name: string): string => path.join(FIXTURES, name);
const KO = fixture('lecture-60s.ko.srt');
const EN = fixture('lecture-60s.en.vtt');
const NOTES = fixture('notes.ko.srt');
const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const overlay = (page: Page) => page.getByTestId('subtitle-drop-overlay');
const twoFrames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** What this platform's Chromium reports as the type of the real files in #drop-source (a dragover sees nothing else of them). */
const reportedTypes = (page: Page) => page.evaluate(() => Array.from((document.getElementById('drop-source') as HTMLInputElement).files!).map((f) => [f.name, f.type]));

async function openLecture(page: Page): Promise<string> {
  const [item] = await importPaths(page, [fixture('lecture-60s.mp4')]);
  await openItem(page, 'lecture-60s');
  await videoReady(page);
  return item!.id;
}
const tracksOf = (page: Page, itemId: string) =>
  page.evaluate(async (itemId) => {
    const r = await window.learn.subtitles.list({ itemId });
    return r.ok ? r.data.tracks.map((t) => t.language) : null;
  }, itemId);

test('a subtitle file dropped on a video tab: the overlay while it is over, then the toast and the track in the menu', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const itemId = await openLecture(page);
    await dropSource(page, [EN, KO]);
    testInfo.annotations.push({ type: 'dragover MIME', description: JSON.stringify(await reportedTypes(page)) });
    await expect(overlay(page)).toHaveCount(0);
    await drag(page, 'dragenter', 'source');
    await expect(overlay(page)).toBeVisible();
    await expect(overlay(page)).toContainText('자막으로 붙이기');
    await expect(overlay(page)).toContainText('SRT · VTT 파일을 이 동영상에 붙입니다');
    expect(await drag(page, 'dragover', 'source')).toBe('copy');
    // ⌥ does not link a subtitle: the drop stays a copy.
    expect(await drag(page, 'dragover', 'source', { altKey: true })).toBe('copy');
    await drag(page, 'drop', 'source');
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.getByTestId('subtitle-attached')).toContainText('자막 2개를 붙였습니다');
    await expect.poll(() => tracksOf(page, itemId)).toEqual(['en', 'ko']);
    await page.getByTestId('subtitles-menu').click();
    await expect(page.getByRole('menuitemradio', { name: '영어' })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: '한국어' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a drop that carries a file that is no subtitle is not taken: the no-drop cursor, no overlay', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const itemId = await openLecture(page);
    // The positive control first: the same gate takes the subtitle alone.
    const subtitle: Array<[string, string]> = [['a.vtt', 'text/vtt']];
    await drag(page, 'dragenter', subtitle);
    await expect(overlay(page)).toBeVisible();
    expect(await drag(page, 'dragover', subtitle)).toBe('copy');
    await drag(page, 'dragleave', subtitle);
    await expect(overlay(page)).toHaveCount(0);

    const mixed: Array<[string, string]> = [['a.vtt', 'text/vtt'], ['notes.pdf', 'application/pdf']];
    await drag(page, 'dragenter', mixed);
    expect(await drag(page, 'dragover', mixed)).toBe('none');
    await twoFrames(page);
    await expect(overlay(page)).toHaveCount(0);
    await drag(page, 'drop', mixed);
    await twoFrames(page);
    await expect(page.getByTestId('subtitle-attached')).toHaveCount(0);
    expect(await tracksOf(page, itemId)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('a video that cannot be played takes no subtitle drop', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [fixture('sample-mpeg4part2.mp4')]);
    await openItem(page, 'sample-mpeg4part2');
    await expect(page.getByTestId('codec-open')).toBeVisible();
    const subtitle: Array<[string, string]> = [['a.vtt', 'text/vtt']];
    await drag(page, 'dragenter', subtitle);
    expect(await drag(page, 'dragover', subtitle)).toBe('none');
    await twoFrames(page);
    await expect(overlay(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a library drop of a video and two subtitles: the summary names them, the ⌥ card says subtitles are copies, the toast counts them', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const three: Array<[string, string]> = [['lecture-60s.mp4', 'video/mp4'], ['lecture-60s.ko.srt', 'application/x-subrip'], ['lecture-60s.en.vtt', 'text/vtt']];
    await drag(page, 'dragenter', three);
    await expect(page.getByTestId('drop-summary')).toHaveText('파일 3개(동영상 1 · 자막 2)');
    await expect(page.getByTestId('drop-link')).toContainText('자막은 사본으로 둡니다.');
    await expect(page.getByTestId('drop-copy')).not.toContainText('자막은 사본으로 둡니다.');
    await drag(page, 'dragleave', three);
    // Without subtitles the card keeps its one sentence.
    const video: Array<[string, string]> = [['lecture-60s.mp4', 'video/mp4']];
    await drag(page, 'dragenter', video);
    await expect(page.getByTestId('drop-link')).not.toContainText('자막은 사본으로 둡니다.');
    await drag(page, 'dragleave', video);

    await dropSource(page, [fixture('lecture-60s.mp4'), KO, EN]);
    await drag(page, 'dragenter', 'source');
    await drag(page, 'drop', 'source');
    await expect(page.getByTestId('import-done')).toContainText('자료 1개를 가져왔습니다 · 자막 2개');
  } finally {
    await app.close();
  }
});

test('a subtitle file alone in a library drop: the failure toast names it with the reason and the common hint', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await dropSource(page, [NOTES]);
    await drag(page, 'dragenter', 'source');
    await drag(page, 'drop', 'source');
    const toast = page.getByTestId('import-failures');
    await expect(toast).toContainText('notes.ko.srt');
    await expect(toast).toContainText('자막 파일은 동영상에 붙입니다');
    await expect(toast).toContainText(/동영상 탭에 끌어\s놓거나 자막 메뉴의 ‘자막\s파일\s추가…’\u2060로 붙이세요\./);
    // The hint comes once, whatever the number of files it covers.
    expect(((await toast.textContent()) ?? '').split('동영상 탭에 끌어').length).toBe(2);
    await expect(page.getByTestId('import-done')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a drop over the transcript sidebar is taken too; the overlay still stands right of it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const itemId = await openLecture(page);
    await dropSource(page, [EN]);
    const side = page.locator('[data-sidebar-area]');
    const box = (await side.boundingBox())!;
    await drag(page, 'dragenter', 'source', { at: 'centre' });
    await expect(overlay(page)).toBeVisible();
    expect((await overlay(page).boundingBox())!.x).toBeGreaterThanOrEqual(box.x + box.width - 1);
    // The drag now moves over the sidebar itself: still a copy, and the drop attaches.
    await page.evaluate((x) => {
      const target = document.elementFromPoint(x, 300)!;
      const dt = new DataTransfer();
      for (const f of Array.from((document.getElementById('drop-source') as HTMLInputElement).files!)) dt.items.add(f);
      const shim = { types: dt.types, items: dt.items, files: dt.files, effectAllowed: 'copyLink', dropEffect: 'copy' };
      const fire = (kind: string) => {
        const e = new DragEvent(kind, { dataTransfer: dt, bubbles: true, cancelable: true });
        Object.defineProperty(e, 'dataTransfer', { value: shim });
        target.dispatchEvent(e);
        return shim.dropEffect;
      };
      fire('dragenter');
      if (fire('dragover') !== 'copy') throw new Error('the sidebar refused the drag');
      fire('drop');
    }, box.x + 40);
    await expect(page.getByTestId('subtitle-attached')).toBeVisible();
    await expect.poll(() => tracksOf(page, itemId)).toEqual(['en']);
  } finally {
    await app.close();
  }
});

test('a file that is no subtitle: its row says why, with no advice to drop it on a video tab', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    const txt = testInfo.outputPath('notes.txt');
    fs.writeFileSync(txt, 'not a subtitle');
    await dropSource(page, [txt]);
    await drag(page, 'dragenter', 'source');
    await expect(overlay(page)).toBeVisible();
    await drag(page, 'drop', 'source');
    const toast = page.getByTestId('subtitle-failed');
    await expect(toast).toContainText('notes.txt');
    await expect(toast).toContainText('자막 파일(SRT · VTT)만 붙일 수 있습니다');
    await expect(toast).not.toContainText('동영상 탭에 끌어');
  } finally {
    await app.close();
  }
});

test('a drop of 60 subtitle files attaches in calls of 50 and reports every file', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const itemId = await openLecture(page);
    const dir = testInfo.outputPath('many');
    fs.mkdirSync(dir, { recursive: true });
    const paths: string[] = [];
    for (let i = 0; i < 60; i++) {
      const p = path.join(dir, `part-${String(i).padStart(2, '0')}.vtt`);
      fs.writeFileSync(p, `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nline ${i}\n`);
      paths.push(p);
    }
    await dropSource(page, paths);
    await drag(page, 'dragenter', 'source');
    await drag(page, 'drop', 'source');
    await expect(page.getByTestId('subtitle-attached')).toBeVisible();
    await expect.poll(async () => (await tracksOf(page, itemId))?.length).toBe(60);
    await expect(page.getByTestId('action-error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
