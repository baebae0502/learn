// Render-only Electron main for the design mockups. It is NOT the app: no preload, no
// IPC, no app protocol, no CSP. It opens one frameless 1440×900 window that the render
// script drives with Playwright (`page.goto(file://…)`), so mockups render with the same
// Chromium as the app (Electron 44 / Chromium 152). The 1440×900 @2x viewport is set by
// the render script through CDP device-metrics emulation, so the physical screen size
// (1440×900 xvfb, a CI Mac display) does not clamp it.
import { app, BrowserWindow } from 'electron';

app.commandLine.appendSwitch('force-device-scale-factor', process.env.MOCKUP_SCALE ?? '2');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.setName('Learn mockups');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: Number(process.env.MOCKUP_WIDTH ?? 1440),
    height: Number(process.env.MOCKUP_HEIGHT ?? 900),
    useContentSize: true,
    frame: false,
    resizable: false,
    enableLargerThanScreen: true,
    show: true,
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  void win.loadURL('about:blank');
});

app.on('window-all-closed', () => app.quit());
