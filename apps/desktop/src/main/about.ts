import type { AboutPanelOptionsOptions } from 'electron';

/** Bundled third-party code and fonts (README "런타임 의존성 라이선스"). macOS shows `credits` in the panel. */
const CREDITS = [
  '글꼴: Pretendard Variable — SIL Open Font License 1.1 (OFL)',
  '아이콘: Lucide — ISC License',
  '컴포넌트: React Aria Components — Apache License 2.0',
  'PDF: PDF.js — Apache License 2.0',
  'React, react-resizable-panels, TanStack Query, zustand, Electron, better-sqlite3 — MIT License',
].join('\n');

export function aboutPanelOptions(version: string, electronVersion: string): AboutPanelOptionsOptions {
  return { applicationName: 'Learn', applicationVersion: version, version: `Electron ${electronVersion}`, copyright: '© 2026 Learn', credits: CREDITS };
}
